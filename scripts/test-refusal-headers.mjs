import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'
import { readFileSync } from 'node:fs'

/**
 * What a refusal from the store looks like: the status, and the headers that
 * say where it came from. A response from an S3-compatible service carries
 * x-amz-request-id; anything else does not.
 */
const source = readFileSync('.env.local', 'utf8')
const value = (name) => {
  const line = source.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim().replace(/^["']/, '').replace(/["']$/, '') : undefined
}

for (const [label, secret] of [
  ['a wrong secret', 'x'.repeat(73)],
  ['the right secret', value('AWS_SECRET_ACCESS_KEY')],
]) {
  const client = new S3Client({
    endpoint: value('AWS_ENDPOINT_URL_S3'),
    region: value('AWS_REGION'),
    forcePathStyle: true,
    credentials: { accessKeyId: value('AWS_ACCESS_KEY_ID'), secretAccessKey: secret },
  })
  try {
    await client.send(new HeadBucketCommand({ Bucket: value('NEON_STORAGE_BUCKET') }))
    console.log(`${label}: OK`)
  } catch (err) {
    const meta = err.$metadata ?? {}
    const headers = meta.httpHeaders ?? {}
    const identifying = Object.entries(headers).filter(
      ([name]) => name.startsWith('x-amz') || name === 'server' || name === 'content-type'
    )
    console.log(`${label}: status ${meta.httpStatusCode}`)
    console.log(`  identifying headers: ${JSON.stringify(identifying)}`)
  }
}
