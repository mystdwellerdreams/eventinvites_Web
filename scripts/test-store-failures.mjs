import { S3Client, HeadBucketCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { readFileSync } from 'node:fs'

/**
 * What the store says for each way of getting it wrong, so the deployment's
 * answer can be matched against one of them.
 */
const source = readFileSync('.env.local', 'utf8')
const value = (name) => {
  const line = source.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim().replace(/^["']/, '').replace(/["']$/, '') : undefined
}

const base = {
  endpoint: value('AWS_ENDPOINT_URL_S3'),
  region: value('AWS_REGION'),
  forcePathStyle: true,
}

const cases = [
  {
    label: 'the right credentials',
    credentials: { accessKeyId: value('AWS_ACCESS_KEY_ID'), secretAccessKey: value('AWS_SECRET_ACCESS_KEY') },
    bucket: value('NEON_STORAGE_BUCKET'),
    command: () => new HeadBucketCommand({ Bucket: value('NEON_STORAGE_BUCKET') }),
  },
  {
    label: 'a wrong secret',
    credentials: { accessKeyId: value('AWS_ACCESS_KEY_ID'), secretAccessKey: 'x'.repeat(73) },
    bucket: value('NEON_STORAGE_BUCKET'),
    command: () => new HeadBucketCommand({ Bucket: value('NEON_STORAGE_BUCKET') }),
  },
  {
    label: 'a wrong bucket name',
    credentials: { accessKeyId: value('AWS_ACCESS_KEY_ID'), secretAccessKey: value('AWS_SECRET_ACCESS_KEY') },
    bucket: 'not-the-bucket',
    command: () => new HeadBucketCommand({ Bucket: 'not-the-bucket' }),
  },
  {
    label: 'a listing (ListObjectsV2)',
    credentials: { accessKeyId: value('AWS_ACCESS_KEY_ID'), secretAccessKey: value('AWS_SECRET_ACCESS_KEY') },
    bucket: value('NEON_STORAGE_BUCKET'),
    command: () => new ListObjectsV2Command({ Bucket: value('NEON_STORAGE_BUCKET'), MaxKeys: 1 }),
  },
]

for (const test of cases) {
  const client = new S3Client({ ...base, credentials: test.credentials })
  try {
    await client.send(test.command())
    console.log(`  OK    ${test.label}`)
  } catch (err) {
    console.log(`  FAIL  ${test.label}: ${err.name}: ${err.message.split('\n')[0]}`)
  }
}
