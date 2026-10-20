import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/** The fingerprint the API logs at startup, computed from the local env. */
const source = readFileSync('.env.local', 'utf8')
const value = (name) => {
  const line = source.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim().replace(/^["']/, '').replace(/["']$/, '') : undefined
}
const fingerprint = (v) => (v ? createHash('sha256').update(v).digest('hex').slice(0, 12) : 'none')
const endpoint = (value('AWS_ENDPOINT_URL_S3') || '').replace(/\/+$/, '')

console.log(
  `[config] store: endpoint=${endpoint} bucket=${value('NEON_STORAGE_BUCKET') || 'eventinvites-storage'} ` +
    `region=${value('AWS_REGION') || 'us-east-1 (the default)'} ` +
    `key=${fingerprint(value('AWS_ACCESS_KEY_ID'))} secret=${fingerprint(value('AWS_SECRET_ACCESS_KEY'))} ` +
    `keyLength=${value('AWS_ACCESS_KEY_ID')?.length ?? 0} secretLength=${value('AWS_SECRET_ACCESS_KEY')?.length ?? 0}`
)
