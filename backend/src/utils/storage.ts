import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

/**
 * The directory this module lives in.
 *
 * A bundle has no `import.meta.url` to work the directory out from, and no
 * filesystem to work it out on either, so the fallback is only ever used
 * where there is a disk to write to.
 */
function moduleDir(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url))
  } catch {
    return process.cwd()
  }
}

/** Where uploads live on disk during local development. */
export const UPLOAD_DIR = path.resolve(moduleDir(), '../../uploads')

/**
 * The URL prefix stored in the database. It is identical in every environment,
 * so moving between a local disk and object storage never invalidates a row.
 */
export const UPLOAD_ROUTE = '/uploads'

export const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

const BLOB_PREFIX = 'uploads'

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
function storeKind(): 'disk' | 's3' {
  const forced = process.env.STORAGE_BACKEND
  if (forced === 'disk' || forced === 's3') return forced
  if (s3Configured()) return 's3'
  return 'disk'
}

/** The store in use, for the health check's report. */
export function storeName(): 'disk' | 'object' {
  return storeKind() === 's3' ? 'object' : 'disk'
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
 * credential or network shows up there just as it would on a real upload.
 */
export async function checkStorage(): Promise<boolean> {
  try {
    if (storeKind() === 's3') {
      // HeadBucket rather than a listing: a bucket's answer is in its headers,
      // while a listing comes back as XML. The Workers runtime has no XML
      // parser, so an operation that answers with XML cannot be read there.
      const { HeadBucketCommand } = await import('@aws-sdk/client-s3')
      const client = await s3()
      await client.send(new HeadBucketCommand({ Bucket: s3Bucket() }))
      return true
    }
    ensureUploadDir()
    await fs.promises.access(UPLOAD_DIR, fs.constants.W_OK)
    return true
  } catch (err) {
    // The reason is logged, because a store that cannot be reached is the one
    // thing an operator cannot work out from a failed health check alone.
    console.error('The upload store did not answer:', err)
    return false
  }
}

export interface SavedUpload {
  /**
   * What gets recorded in the database.
   *
   * It names the file rather than the store, so the row keeps working when
   * the bytes move to another store, and it is served by the
   * `/uploads/:filename` route below.
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
  if (storeKind() === 's3') return resolveS3Upload(filename)
  return resolveDiskUpload(filename)
}

export async function deleteUpload(filename: string): Promise<void> {
  if (storeKind() === 's3') {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await s3()
    await client.send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: s3Key(filename) }))
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
