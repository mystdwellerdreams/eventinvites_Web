import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { prisma } from './prisma'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))

/** Where uploads live on disk during local development. */
export const UPLOAD_DIR = path.resolve(moduleDir, '../../uploads')

/**
 * The URL prefix stored in the database. It is identical in every environment,
 * so moving between a local disk and object storage never invalidates a row.
 */
export const UPLOAD_ROUTE = '/uploads'

export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const BLOB_PREFIX = 'uploads'

/**
 * Object storage is used whenever a Blob token is configured. Vercel's
 * filesystem is ephemeral and read-only between invocations, so a local disk is
 * only viable for development.
 */
const useBlob = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN)

/** Lazily imported so development works even if the dependency is absent. */
let blobClient: typeof import('@vercel/blob') | null = null
async function blob(): Promise<typeof import('@vercel/blob')> {
  if (!blobClient) blobClient = await import('@vercel/blob')
  return blobClient
}

/** Setting key remembering whether the store refuses public access. */
const STORE_ACCESS_SETTING = 'blob_store_access'

/**
 * `public`, `private`, or null while still unknown. A store created with
 * private access rejects public uploads, and the two cannot be mixed: the
 * first upload settles which one this deployment talks to, and the answer is
 * remembered so later requests — and other processes — do not have to probe.
 */
let storeAccess: 'public' | 'private' | null = null

function isPrivateAccessError(err: unknown): boolean {
  return err instanceof Error && /private access/i.test(err.message)
}

async function detectStoreAccess(): Promise<'public' | 'private' | null> {
  if (storeAccess) return storeAccess
  const row = await prisma.setting.findUnique({
    where: { key: STORE_ACCESS_SETTING },
    select: { value: true },
  })
  if (row && (row.value === 'public' || row.value === 'private')) {
    storeAccess = row.value
  }
  return storeAccess
}

async function rememberStoreAccess(access: 'public' | 'private'): Promise<void> {
  storeAccess = access
  await prisma.setting.upsert({
    where: { key: STORE_ACCESS_SETTING },
    update: { value: access },
    create: { key: STORE_ACCESS_SETTING, value: access },
  })
}

export function isBlobStorage(): boolean {
  return useBlob()
}

export function ensureUploadDir(): void {
  if (useBlob()) return
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  }
}

/**
 * Answers whether the upload store can be reached. On a local disk that is
 * the upload directory existing and being writable; with object storage a
 * one-entry listing is the cheapest reachability probe, and a failing
 * token or network shows up there just as it would on a real upload.
 */
export async function checkStorage(): Promise<boolean> {
  try {
    if (useBlob()) {
      const { list } = await blob()
      await list({ limit: 1, token: process.env.BLOB_READ_WRITE_TOKEN })
      return true
    }
    ensureUploadDir()
    await fs.promises.access(UPLOAD_DIR, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export interface SavedUpload {
  /**
   * What gets recorded in the database.
   *
   * With object storage this is the store's own URL, so the row keeps
   * pointing at the bytes when they move to another store. On a local disk
   * it is a path served by the `/uploads/:filename` route below.
   */
  url: string
}

export async function saveUpload(file: Express.Multer.File): Promise<SavedUpload> {
  if (!file) throw new Error('No file uploaded')

  const extension = path.extname(file.originalname) || '.png'
  const filename = `${randomUUID()}${extension}`

  if (useBlob()) {
    const { put } = await blob()
    const token = process.env.BLOB_READ_WRITE_TOKEN
    const shared = {
      contentType: file.mimetype,
      token,
      // The filename is already unique, so no further suffix is wanted.
      addRandomSuffix: false,
    }

    const access = (await detectStoreAccess()) ?? 'public'
    try {
      const result = await put(`${BLOB_PREFIX}/${filename}`, file.buffer, {
        ...shared,
        access,
      })
      return { url: result.url }
    } catch (err) {
      // A store configured for private access refuses the public upload; the
      // retry with private access succeeds and is remembered.
      if (!isPrivateAccessError(err)) throw err
      await rememberStoreAccess('private')
      const result = await put(`${BLOB_PREFIX}/${filename}`, file.buffer, {
        ...shared,
        access: 'private',
      })
      return { url: result.url }
    }
  }

  ensureUploadDir()
  await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), file.buffer)
  return { url: `${UPLOAD_ROUTE}/${filename}` }
}

export type ResolvedUpload = {
  /** The whole file, when it is served through this app. Uploads are capped
   *  at 5 MB, so holding one in memory to answer a request is cheaper than
   *  wiring a stream through the API catch-all, which gathers responses
   *  into a buffer anyway. */
  body?: Buffer
  /** Where the browser should be sent instead, for a public store. */
  redirectTo?: string
  contentType: string
  size?: number
}

/**
 * Reads a file from the local disk. Only used in development: with object
 * storage configured the database holds store URLs and this branch is
 * never reached.
 */
async function resolveDiskUpload(filename: string): Promise<ResolvedUpload | null> {
  ensureUploadDir()
  const filePath = path.join(UPLOAD_DIR, filename)
  if (!fs.existsSync(filePath)) return null
  const body = await fs.promises.readFile(filePath)
  return {
    body,
    contentType: contentTypeFor(filename),
    size: body.byteLength,
  }
}

/**
 * Finds a file in object storage. The route is reached with a name, because
 * that is what `/uploads/<file>` URLs carry, so the store is searched by
 * that prefix. A private store hands the bytes over for this app to serve;
 * a public one is answered with a redirect, leaving the transfer to the CDN.
 */
async function resolveBlobUpload(filename: string): Promise<ResolvedUpload | null> {
  const { list } = await blob()
  const token = process.env.BLOB_READ_WRITE_TOKEN
  const contentType = contentTypeFor(filename)

  const found = await list({
    prefix: `${BLOB_PREFIX}/${filename}`,
    limit: 1,
    token,
  })
  const blobEntry = found.blobs[0]
  if (!blobEntry) return null

  const access = await detectStoreAccess()
  if (access === 'public') {
    return { redirectTo: blobEntry.url, contentType, size: blobEntry.size }
  }
  const body = await readBlobBytes(blobEntry.url)
  if (!body) return null
  return { body, contentType, size: body.byteLength }
}

/** Reads a blob's bytes, trying the public read before the private one. */
async function readBlobBytes(url: string): Promise<Buffer | null> {
  const { get } = await blob()
  const token = process.env.BLOB_READ_WRITE_TOKEN
  // A private store refuses the public read, so the modes are tried in
  // turn and the one that works wins.
  for (const access of ['public', 'private'] as const) {
    try {
      const result = await get(url, { access, token })
      if (!result || !result.stream) continue
      return Buffer.from(await new Response(result.stream).arrayBuffer())
    } catch {
      // The other access mode is tried next.
    }
  }
  return null
}

export async function resolveUpload(filename: string): Promise<ResolvedUpload | null> {
  if (useBlob()) return resolveBlobUpload(filename)
  return resolveDiskUpload(filename)
}

export async function deleteUpload(filename: string): Promise<void> {
  if (useBlob()) {
    const { del } = await blob()
    // The database may hold a store URL rather than a bare name, so both
    // shapes are tried.
    await del(filename, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() =>
      del(`${BLOB_PREFIX}/${path.basename(filename)}`, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      })
    )
    return
  }
  ensureUploadDir()
  const filePath = path.join(UPLOAD_DIR, filename)
  if (fs.existsSync(filePath)) await fs.promises.unlink(filePath)
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

export function contentTypeFor(filename: string): string {
  return MIME_BY_EXTENSION[path.extname(filename).toLowerCase()] ?? 'application/octet-stream'
}
