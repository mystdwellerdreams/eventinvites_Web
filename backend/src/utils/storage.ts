import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { createHash } from 'crypto'
import { envValue, hasQuotes } from './env'

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
const s3Bucket = () => envValue('NEON_STORAGE_BUCKET') || 'eventinvites-storage'

/**
 * Whether the app is running somewhere the filesystem is not its own.
 *
 * The disk store is for development. On Vercel, on the Workers runtime and
 * anywhere else that discards the filesystem between requests, uploads need
 * an object store.
 */
const isServerlessHost = () =>
  Boolean(envValue('VERCEL') || envValue('VERCEL_ENV') || envValue('APP_RUNTIME') === 'workers')

const s3Access = (): 'public' | 'private' =>
  envValue('NEON_STORAGE_ACCESS') === 'public' ? 'public' : 'private'

const s3Configured = () =>
  Boolean(
    envValue('AWS_ENDPOINT_URL_S3') &&
      envValue('AWS_ACCESS_KEY_ID') &&
      envValue('AWS_SECRET_ACCESS_KEY')
  )

/** The S3 endpoint without a trailing slash, which the URL builders need. */
const s3Endpoint = () => (envValue('AWS_ENDPOINT_URL_S3') || '').replace(/\/+$/, '')

/** Where a public bucket serves an object from. */
const s3PublicUrl = (key: string) => `${s3Endpoint()}/${s3Bucket()}/${key}`

/** The key an upload is stored under. */
const s3Key = (filename: string) => `${BLOB_PREFIX}/${path.basename(filename)}`

type S3Module = typeof import('@aws-sdk/client-s3')

/** Lazily imported so a disk or Blob deployment does not load the SDK. */
let s3Instance: InstanceType<S3Module['S3Client']> | null = null

/**
 * The store's client.
 *
 * The endpoint is normalised before it is given to the client: a trailing
 * slash would put a second one in the path the signature covers.
 */
async function s3(
  overrides: Partial<ConstructorParameters<typeof import('@aws-sdk/client-s3')['S3Client']>[0]> = {}
): Promise<InstanceType<S3Module['S3Client']>> {
  const { S3Client } = await import('@aws-sdk/client-s3')
  const config = {
    endpoint: s3Endpoint(),
    region: envValue('AWS_REGION') || 'us-east-1',
    // The bucket is part of the path rather than of the hostname.
    forcePathStyle: true,
    credentials: {
      accessKeyId: envValue('AWS_ACCESS_KEY_ID') as string,
      secretAccessKey: envValue('AWS_SECRET_ACCESS_KEY') as string,
    },
  }
  // A client with its own handler is a separate client, not the shared one.
  if (overrides.requestHandler) {
    return new S3Client({ ...config, ...overrides })
  }
  if (!s3Instance) {
    s3Instance = new S3Client(config)
  }
  return s3Instance
}

/**
 * Which store the deployment uses. `STORAGE_BACKEND` forces one; otherwise
 * the first configured store wins, so a deployment only has to carry the
 * credentials of the store it actually uses.
 */
function storeKind(): 'disk' | 's3' {
  const forced = envValue('STORAGE_BACKEND')
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

/**
 * Creates the local upload directory, where there is one to create.
 *
 * It must not throw. On a serverless host the filesystem is read-only, and a
 * store that was never configured leaves the deployment on the disk path: the
 * directory cannot be made there, and an exception at startup would take the
 * whole API down over a missing configuration. The uploads fail with a clear
 * message instead, and the rest of the API keeps answering.
 */
export function ensureUploadDir(): void {
  if (!usesLocalDisk()) return
  try {
    if (!fs.existsSync(UPLOAD_DIR)) {
      fs.mkdirSync(UPLOAD_DIR, { recursive: true })
    }
  } catch (err) {
    console.error(
      `[config] The upload directory could not be created at ${UPLOAD_DIR}. ` +
        'On a serverless host the filesystem is read-only, so the uploads need ' +
        'an object store: set AWS_ENDPOINT_URL_S3 and the rest of the storage ' +
        `variables. (${(err as Error).message})`
    )
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
    describeRefusal(err)
    return false
  }
}

/**
 * What the store said in its own words.
 *
 * A refusal carries headers that say where it came from: an S3-compatible
 * service sends `x-amz-request-id`, and anything else does not. The body is
 * the service's explanation, so the first of it is worth having.
 */
function describeRefusal(err: unknown): void {
  const meta = (err as { $metadata?: { httpHeaders?: Record<string, string>; httpStatusCode?: number } })
    .$metadata
  const headers = meta?.httpHeaders ?? {}
  const interesting = Object.entries(headers).filter(
    ([name]) => name.startsWith('x-amz') || name === 'server' || name === 'content-type'
  )
  console.error(
    `[config] the store refused with ${meta?.httpStatusCode ?? 'no status'}: ` +
      (interesting.length
        ? interesting.map(([name, value]) => `${name}=${value}`).join(' ')
        : 'no identifying headers')
  )
}

/**
 * The request as it was signed.
 *
 * The signature covers the method, the path, the headers and the time. A
 * refusal says the store did not agree with one of them, and the parts that
 * are written down here are the ones that can be compared between a
 * deployment and a checkout.
 */
async function describeSignedRequest(): Promise<void> {
  if (storeKind() !== 's3') return

  const { NodeHttpHandler } = await import('@smithy/node-http-handler')
  const inner = new NodeHttpHandler()

  const client = await s3({
    requestHandler: {
      handle: async (request: { headers: Record<string, string> }) => {
        const headers = request.headers ?? {}
        const authorization = headers['authorization'] ?? headers['Authorization'] ?? ''
        console.error(
          `[config] the request signed: host=${headers['host'] ?? headers['Host'] ?? '?'} ` +
            `date=${headers['x-amz-date'] ?? '?'} ` +
            `sha256=${(headers['x-amz-content-sha256'] ?? '?').slice(0, 16)} ` +
            `signedHeaders=${authorization.split('SignedHeaders=')[1]?.split(',').join('+') ?? '?'} ` +
            `scope=${authorization.split('Credential=')[1]?.split('/').slice(1).join('/') ?? '?'} ` +
            `sdk=${(headers['x-amz-user-agent'] ?? '?').split(' ')[0]}`
        )
        const result = await inner.handle(request as never)
        // The service's own explanation, read before the error middleware
        // tries to make sense of it.
        const raw = result.response as unknown as {
          statusCode?: number
          body?: { transformToString?: () => Promise<string> }
        }
        try {
          const body = await raw.body?.transformToString?.()
          console.error(
            `[config] the store answered ${raw.statusCode ?? 'no status'}: ${(body ?? '').slice(0, 300)}`
          )
        } catch {
          console.error(`[config] the store answered ${raw.statusCode ?? 'no status'}: no body`)
        }
        return result
      },
    },
  })

  const { HeadBucketCommand } = await import('@aws-sdk/client-s3')
  try {
    await client.send(new HeadBucketCommand({ Bucket: s3Bucket() }))
  } catch {
    // The refusal itself is reported elsewhere; this is only here to see how
    // the request was signed.
  }
}

/**
 * Tries the store a few ways and says which of them work.
 *
 * A refusal on its own does not say what is wrong: a wrong secret and a
 * request that never reached the store look the same from the outside. What
 * does say is which operations succeed, so a few of them are tried and the
 * results written down.
 */
async function describeStore(): Promise<void> {
  if (storeKind() !== 's3') return

  const { HeadBucketCommand, ListObjectsV2Command, GetBucketLocationCommand } = await import(
    '@aws-sdk/client-s3'
  )
  const client = await s3()

  const operations: [string, () => Promise<unknown>][] = [
    ['HeadBucket', () => client.send(new HeadBucketCommand({ Bucket: s3Bucket() }))],
    ['GetBucketLocation', () => client.send(new GetBucketLocationCommand({ Bucket: s3Bucket() }))],
    ['ListObjectsV2', () => client.send(new ListObjectsV2Command({ Bucket: s3Bucket(), MaxKeys: 1 }))],
  ]

  for (const [name, run] of operations) {
    try {
      await run()
      console.error(`[config] ${name}: ok`)
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      console.error(`[config] ${name}: refused with ${status ?? 'no status'}`)
    }
  }

  // An unsigned request says whether the host and the path are right at all:
  // a store that is reachable answers with its own refusal, and anything else
  // answers with something that is not the store.
  try {
    const response = await fetch(`${s3Endpoint()}/${s3Bucket()}`)
    console.error(`[config] an unsigned request to the bucket: ${response.status}`)
  } catch (err) {
    console.error(`[config] an unsigned request to the bucket failed: ${(err as Error).message}`)
  }

  // Where the endpoint actually leads. The same name can resolve to different
  // addresses in different places, and a store on one of them may not be the
  // store the credentials belong to.
  try {
    const { lookup } = await import('node:dns/promises')
    const host = new URL(s3Endpoint()).hostname
    const addresses = await lookup(host, { all: true })
    console.error(
      `[config] the endpoint resolves to: ${addresses
        .map((entry) => `${entry.address}/${entry.family}`)
        .join(', ')}`
    )
  } catch (err) {
    console.error(`[config] the endpoint did not resolve: ${(err as Error).message}`)
  }

  // A request signed by hand, with only the host, the payload's hash and the
  // time in the signature. The SDK signs more headers than that, and a service
  // that reconstructs the canonical request from what it received can find one
  // of them missing and refuse the signature without saying why.
  try {
    const { signRequest } = await import('./s3sign')
    const signed = signRequest({
      method: 'HEAD',
      endpoint: s3Endpoint(),
      bucket: s3Bucket(),
      keyId: envValue('AWS_ACCESS_KEY_ID') as string,
      secret: envValue('AWS_SECRET_ACCESS_KEY') as string,
      region: envValue('AWS_REGION'),
    })
    const response = await fetch(signed.url, { method: 'HEAD', headers: signed.headers })
    console.error(`[config] a hand-signed request: ${response.status}`)
  } catch (err) {
    console.error(`[config] a hand-signed request failed: ${(err as Error).message}`)
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
 * Says out loud what is wrong with the store's configuration.
 *
 * The health check can only report that the store did not answer. The log is
 * where the reason is, and the usual causes are a variable that was never set
 * and a value that was copied with its quotes still around — a dashboard's
 * environment variable takes the value itself, not the quoted form the local
 * .env files use.
 */
export async function reportStoreConfiguration(): Promise<void> {
  if (storeKind() !== 's3') {
    // A serverless host has no disk to fall back to, so a store that was
    // never configured leaves the uploads with nowhere to go.
    if (isServerlessHost()) {
      console.error(
        '[config] No upload store is configured, so the uploads have nowhere ' +
          'to go. Set AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID, ' +
          'AWS_SECRET_ACCESS_KEY and NEON_STORAGE_BUCKET.'
      )
    }
    return
  }

  const names = [
    'AWS_ENDPOINT_URL_S3',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'NEON_STORAGE_BUCKET',
  ]

  for (const name of names) {
    if (!envValue(name)) {
      console.error(`[config] ${name} is not set, so the upload store cannot be reached.`)
      continue
    }
    if (hasQuotes(name)) {
      console.error(
        `[config] ${name} is wrapped in quotes. A deployment's environment variable takes the value itself, not the quoted form; the quotes are stripped here, but it is worth fixing.`
      )
    }
  }

  const keyId = envValue('AWS_ACCESS_KEY_ID')
  if (keyId && !/^nak_/.test(keyId)) {
    console.error('[config] AWS_ACCESS_KEY_ID does not look like a Neon access key.')
  }

  // A fingerprint of the configuration, so that a deployment which cannot
  // reach the bucket can be compared with the one that can. The key itself is
  // never written down: only the first few characters of its hash, which are
  // enough to tell two keys apart and useless without the secret.
  const fingerprint = (value: string | undefined) =>
    value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : 'none'
  console.error(
    `[config] store: endpoint=${s3Endpoint()} bucket=${s3Bucket()} ` +
      `region=${envValue('AWS_REGION') || 'us-east-1 (the default)'} ` +
      `key=${fingerprint(keyId)} secret=${fingerprint(envValue('AWS_SECRET_ACCESS_KEY'))} ` +
      `keyLength=${keyId?.length ?? 0} secretLength=${envValue('AWS_SECRET_ACCESS_KEY')?.length ?? 0}`
  )

  await describeStore()
  await describeSignedRequest()
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
