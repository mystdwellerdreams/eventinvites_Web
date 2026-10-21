import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { randomUUID, createHash } from 'crypto'
import { prisma } from './prisma'
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
 * Vercel Blob.
 *
 * The store is used whenever a Blob token is configured, which is what it has
 * always been: the filesystem of a serverless host is ephemeral, so a local
 * disk is only viable for development.
 */
const useBlob = () => Boolean(envValue('BLOB_READ_WRITE_TOKEN'))

/** Lazily imported so development works even if the dependency is absent. */
let blobClient: typeof import('@vercel/blob') | null = null
async function blob(): Promise<typeof import('@vercel/blob')> {
  if (!blobClient) blobClient = await import('@vercel/blob')
  return blobClient
}

/** Setting key remembering whether the store refuses public access. */
const STORE_ACCESS_SETTING = 'blob_store_access'

/**
 * The key the store's access mode is remembered under.
 *
 * The mode belongs to the store rather than to the deployment: one created
 * for public access refuses private uploads, and one created for private
 * access refuses public ones. Two deployments can point at two stores while
 * a changeover is in progress, so the answer is kept per store — the
 * store's own identifier, when the environment carries one, is what tells
 * them apart.
 */
function storeAccessKey(): string {
  const id = envValue('BLOB_STORE_ID')
  return id ? `${STORE_ACCESS_SETTING}:${id}` : STORE_ACCESS_SETTING
}

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
    where: { key: storeAccessKey() },
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
    where: { key: storeAccessKey() },
    update: { value: access },
    create: { key: storeAccessKey(), value: access },
  })
}

/**
 * S3-compatible object storage.
 *
 * Neon Object Storage speaks the S3 API and reads the AWS SDK's own
 * environment variables, so the same code path serves it and any other
 * S3-compatible store.
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
 * Which store the deployment uses.
 *
 * `STORAGE_BACKEND` forces one. Otherwise the first configured store wins, so
 * a deployment only has to carry the credentials of the store it actually
 * uses: a Blob token means Vercel Blob, an S3 configuration means
 * S3-compatible storage, and neither means the local disk.
 */
function storeKind(): 'disk' | 'blob' | 's3' {
  const forced = envValue('STORAGE_BACKEND')
  if (forced === 'disk' || forced === 'blob' || forced === 's3') return forced
  if (useBlob()) return 'blob'
  if (s3Configured()) return 's3'
  return 'disk'
}

export function isBlobStorage(): boolean {
  return storeKind() === 'blob'
}

/** The store in use, for the health check's report. */
export function storeName(): 'disk' | 'blob' | 'object' {
  const kind = storeKind()
  if (kind === 'blob') return 'blob'
  return kind === 's3' ? 'object' : 'disk'
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
        'an object store: set BLOB_READ_WRITE_TOKEN, or the AWS_* variables ' +
        `for an S3-compatible one. (${(err as Error).message})`
    )
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
    const kind = storeKind()
    if (kind === 'blob') {
      const { list } = await blob()
      await list({ limit: 1, token: envValue('BLOB_READ_WRITE_TOKEN') })
      return true
    }
    if (kind === 's3') {
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

  if (storeKind() === 'blob') {
    const { put } = await blob()
    const token = envValue('BLOB_READ_WRITE_TOKEN')
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
 * Finds a file in Vercel Blob. The route is reached with a name, because
 * that is what `/uploads/<file>` URLs carry, so the store is searched by
 * that prefix. A private store hands the bytes over for this app to serve;
 * a public one is answered with a redirect, leaving the transfer to the CDN.
 */
async function resolveBlobUpload(filename: string): Promise<ResolvedUpload | null> {
  const { list } = await blob()
  const token = envValue('BLOB_READ_WRITE_TOKEN')
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
  const token = envValue('BLOB_READ_WRITE_TOKEN')
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
  if (kind === 'blob') return resolveBlobUpload(filename)
  if (kind === 's3') return resolveS3Upload(filename)
  return resolveDiskUpload(filename)
}

export async function deleteUpload(filename: string): Promise<void> {
  const kind = storeKind()
  if (kind === 'blob') {
    const { del } = await blob()
    const token = envValue('BLOB_READ_WRITE_TOKEN')
    // The store knows the path an upload was written to, so that is what it
    // is asked to remove. The row may hold the store's own URL or a bare
    // name, and removing something that is not there is not an error, so the
    // path is tried first.
    for (const target of [`${BLOB_PREFIX}/${path.basename(filename)}`, filename]) {
      try {
        await del(target, { token })
        return
      } catch {
        // The other shape is tried next.
      }
    }
    return
  }
  if (kind === 's3') {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const client = await s3()
    await client.send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: s3Key(filename) }))
    return
  }
  ensureUploadDir()
  const filePath = path.join(UPLOAD_DIR, filename)
  if (fs.existsSync(filePath)) await fs.promises.unlink(filePath)
}

/**
 * Says what is wrong with the store's configuration.
 *
 * The health check can only report that the store did not answer. The log is
 * where the reason is, and the usual causes are a variable that was never set
 * and a value that was copied with its quotes still around — a deployment's
 * environment variable takes the value itself, not the quoted form the local
 * .env files use.
 */
export async function reportStoreConfiguration(): Promise<void> {
  const kind = storeKind()

  if (kind === 'disk') {
    // A serverless host has no disk to fall back to, so a store that was
    // never configured leaves the uploads with nowhere to go.
    if (isServerlessHost()) {
      console.error(
        '[config] No upload store is configured, so the uploads have nowhere ' +
          'to go. Set BLOB_READ_WRITE_TOKEN, or the AWS_* variables for an ' +
          'S3-compatible store.'
      )
    }
    return
  }

  if (kind === 'blob') {
    const token = envValue('BLOB_READ_WRITE_TOKEN')
    if (!token) {
      console.error('[config] BLOB_READ_WRITE_TOKEN is not set, so the upload store cannot be reached.')
    } else if (hasQuotes('BLOB_READ_WRITE_TOKEN')) {
      console.error(
        '[config] BLOB_READ_WRITE_TOKEN is wrapped in quotes. A deployment\'s environment variable takes the value itself, not the quoted form; the quotes are stripped here, but it is worth fixing.'
      )
    }
    console.error(
      `[config] store: Vercel Blob, token ${fingerprint(token)}, access ${(await detectStoreAccess()) ?? 'unknown'}`
    )
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

  console.error(
    `[config] store: endpoint=${s3Endpoint()} bucket=${s3Bucket()} ` +
      `region=${envValue('AWS_REGION') || 'us-east-1 (the default)'} ` +
      `key=${fingerprint(keyId)} secret=${fingerprint(envValue('AWS_SECRET_ACCESS_KEY'))}`
  )

  await describeStore()
  await describeSignedRequest()
}

/**
 * A fingerprint of a value, so that a deployment which cannot reach its
 * store can be compared with the one that can. The value itself is never
 * written down: only the first few characters of its hash, which are enough
 * to tell two apart and useless without the secret.
 */
function fingerprint(value: string | undefined): string {
  return value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : 'none'
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

function contentTypeFor(filename: string): string {
  const extension = path.extname(filename).toLowerCase()
  switch (extension) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}
