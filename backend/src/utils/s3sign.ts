import { createHash, createHmac } from 'node:crypto'

/**
 * A minimal SigV4 signature, written out rather than taken from the SDK.
 *
 * It signs the host, the payload's hash and the time, and nothing else, which
 * is the classic form that every S3-compatible service accepts. The SDK signs
 * more headers — the user agent and its own request identifiers — and a
 * service that reconstructs the canonical request from what it received, and
 * finds one of them missing or changed, refuses the signature without saying
 * why.
 */
export interface SignedRequest {
  url: string
  headers: Record<string, string>
}

export function signRequest(options: {
  method: string
  endpoint: string
  bucket: string
  keyId: string
  secret: string
  region?: string
  key?: string
  body?: Buffer
}): SignedRequest {
  const { method, endpoint, bucket, keyId, secret, body } = options
  const region = options.region || 'us-east-1'
  const url = new URL(`${endpoint.replace(/\/+$/, '')}/${bucket}${options.key ? `/${options.key}` : ''}`)
  const host = url.host
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payload = body ?? Buffer.alloc(0)
  const payloadHash = createHash('sha256').update(payload).digest('hex')

  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = [
    method,
    url.pathname,
    url.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const hmac = (key: Buffer | string, data: string) =>
    createHmac('sha256', key).update(data).digest()
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), 's3'),
    'aws4_request'
  )
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  return {
    url: url.toString(),
    headers: {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization:
        `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  }
}
