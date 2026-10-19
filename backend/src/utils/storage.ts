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

/**
 * S3-compatible object storage. Neon Object Storage speaks the S3 API and
 * reads the AWS SDK's own environment variables, so the same code path serves
 * it and any other S3-compatible store.
 *
 * The bucket's access level is a property of the bucket rather than of the
 * request, so it is stated in the environment instead of being probed: a
 * public bucket answers the browser itself, a private one is read with the
 * credentials and handed on by this app.
 */
const s3Bucket = () => process.env.NEON_STORAGE_BUCKET || 'eventinvites-storage'

const s3Access = (): 'public' | 'private' =>
  process.env.NEON_STORAGE_ACCESS === 'public' ? 'public' : 'private'

const s3Configured = () =>
  Boolean(
    process.env.AWS_ENDPOINT_URL_S3 &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
  )

/** The S3 endpoint without a trailing slash, which the URL builders need. */
const s3Endpoint = () => (process.env.AWS_ENDPOINT_URL_S3 || '').replace(/\/+$/, '')

/** Where a public bucket serves an object from. */
const s3PublicUrl = (key: string) => `${s3Endpoint()}/${s3Bucket()}/${key}`

/** The key an upload is stored under. */
const s3Key = (filename: string) => `${BLOB_PREFIX}/${path.basename(filename)}`

type S3Module = typeof import('@aws-sdk/client-s3')

/** Lazily imported so a disk or Blob deployment does not load the SDK. */
let s3Instance: InstanceType<S3Module['S3Client']> | null = null
async function s3(): Promise<InstanceType<S3Module['S3Client']>> {
  if (!s3Instance) {
    const { S3Client } = await import('@aws-sdk/client-s3')
    s3Instance = new S3Client({
      endpoint: process.env.AWS_ENDPOINT_URL_S3,
      region: process.env.AWS_REGION || 'us-east-1',
      // The bucket is part of the path rather than of the hostname.
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY as string,
      },
    })
  }
  return s3Instance
}

/**
 * Which store the deployment uses. `STORAGE_BACKEND` forces one; otherwise
 * the first configured store wins, so a deployment only has to carry the
 * credentials of the store it actually uses.
 */
function storeKind(): 'disk' | 'blob' | 's3' {
  const forced = process.env.STORAGE_BACKEND
  if (forced === 'disk' || forced === 'blob' || forced === 's3') return forced
  if (s3Configured()) return 's3'
  if (useBlob()) return 'blob'
  return 'disk'
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
  return storeKind() === 'blob'
}

/** Whether uploads land on a local disk, which only development does. */
export function usesLocalDisk(): boolean {
  return storeKind() === 'disk'
}

export function ensureUploadDir(): void {
  if (usesLocalDisk()) {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true })
    }
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
    if (storeKind() === 's3') {
      const { ListObjectsV2Command } = await import('@aws-sdk/client-s3')
      const client = await s3()
      await client.send(new ListObjectsV2Command({ Bucket: s3Bucket(), MaxKeys: 1 }))
      return true
    }
    if (storeKind() === 'blob') {
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
   * With Vercel Blob this is the store's own URL, so the row keeps pointing
   * at the bytes when they move to another store. Every other store records
   * the path served by the `/uploads/:filename` route below, which names the
   * file rather than the store and so outlives a change of store.
   */
  url: string
}

export async function saveUpload(file: Express.Multer.File): Promise<SavedUpload> {
  if (!file) throw new Error('No file uploaded')

  const extension = path.extname(file.originalname) || '.png'
  const filename = `${randomUUID()}${extension}`

  if (storeKind() === 's3') {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await s3()
    await client.send(
      new PutObjectCommand({
        Bucket: s3Bucket(),
        Key: s3Key(filename),
        Body: file.buffer,
        ContentType: file.mimetype,
      })
    )
    // The row names the file rather than the store, so the same path keeps
    // working whichever store holds the bytes.
    return { url: `${UPLOAD_ROUTE}/${filename}` }
  }

  if (storeKind() === 'blob') {
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

/**
 * Finds a file in an S3-compatible store. A public bucket is answered with a
 * redirect, leaving the transfer to the store; a private one is read with the
 * credentials and handed on by this app.
 */
async function resolveS3Upload(filename: string): Promise<ResolvedUpload | null> {
  const { GetObjectCommand, HeadObjectCommand } = await import('@aws-sdk/client-s3')
  const client = await s3()
  const key = s3Key(filename)
  const contentType = contentTypeFor(filename)

  if (s3Access() === 'public') {
    try {
      const head = await client.send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: key }))
      return {
        redirectTo: s3PublicUrl(key),
        contentType: head.ContentType || contentType,
        size: head.ContentLength,
      }
    } catch {
      return null
    }
  }

  try {
    const result = await client.send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }))
    const bytes = await result.Body?.transformToByteArray()
    if (!bytes) return null
    const body = Buffer.from(bytes)
    return { body, contentType: result.ContentType || contentType, size: body.byteLength }
  } catch {
    return null
  }
}

export async function resolveUpload(filename: string): Promise<ResolvedUpload | null> {
  const kind = storeKind()
  if (kind === 's3') return resolveS3Upload(filename)
  if (kind === 'blob') return resolveBlobUpload(filename)
  return resolveDiskUpload(filename)
}

export async function deleteUpload(filename: string): Promise<void> {
  if (storeKind() === 's3') {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await s3()
    await client.send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: s3Key(filename) }))
    return
  }
  if (storeKind() === 'blob') {
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
