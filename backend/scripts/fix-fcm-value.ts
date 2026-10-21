import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Rewrites the service account in .env.local so that it survives the file's
 * own parser.
 *
 * A .env file cannot carry the document directly: the parser stops an
 * unquoted value at the first quote, and a quoted one has its outer quotes
 * stripped while the inner ones stay escaped. So the document goes in base64,
 * which is what the API's parser expects as its second form.
 */
const path = '../.env.local'
const lines = readFileSync(path, 'utf8').split(/\r?\n/)
const index = lines.findIndex((line) => line.startsWith('FCM_SERVICE_ACCOUNT_JSON='))
if (index < 0) {
  console.log('the variable is not in the file')
  process.exit(1)
}

// The value as the file holds it, before the parser had a go at it.
const stored = lines[index].slice('FCM_SERVICE_ACCOUNT_JSON='.length).trim()

// The same three forms the API tries.
const repair = (value: string) => {
  const unescaped = value.replace(/\\"/g, '"')
  let out = ''
  let inString = false
  for (const char of unescaped) {
    if (char === '"') {
      inString = !inString
      out += char
      continue
    }
    if (char === '\n' || char === '\r') {
      out += inString ? '\\n' : ' '
      continue
    }
    out += char
  }
  return out
}

let account: Record<string, unknown> | null = null
const candidates = [stored, repair(stored), `{${repair(stored)}}`]
try {
  const decoded = Buffer.from(stored.replace(/^["']|["']$/g, ''), 'base64').toString('utf8')
  if (decoded.includes('{')) candidates.push(decoded)
} catch {
  // Not base64.
}
for (const candidate of candidates) {
  try {
    const parsed: unknown = JSON.parse(candidate)
    const unwrapped = typeof parsed === 'string' ? JSON.parse(parsed) : parsed
    if (unwrapped && typeof unwrapped === 'object') {
      account = unwrapped as Record<string, unknown>
      break
    }
  } catch {
    // The next form.
  }
}

if (!account || !account.client_email || !account.private_key) {
  console.log('the service account could not be read in any form')
  process.exit(1)
}

// The key's line breaks may have been escaped twice on the way here, which
// leaves the base64 body on one line and the key unreadable.
const rawKey = account.private_key as string
const key = rawKey.includes('\\n') && !rawKey.includes('\n')
  ? rawKey.replace(/\\\\n/g, '\\n')
  : rawKey
account.private_key = key

const encoded = Buffer.from(JSON.stringify(account), 'utf8').toString('base64')
lines[index] = `FCM_SERVICE_ACCOUNT_JSON="${encoded}"`
writeFileSync(path, lines.join('\n'))

console.log('rewrote the service account as base64')
console.log('  project:', account.project_id)
console.log('  bytes:  ', encoded.length)


