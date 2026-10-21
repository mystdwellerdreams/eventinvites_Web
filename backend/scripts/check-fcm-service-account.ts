import dotenv from 'dotenv'
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isPushConfigured } from '../src/utils/push'

/**
 * Checks the Firebase service account the API would use: that the API itself
 * accepts it, that it belongs to the same Firebase project as the app, and
 * that Google will issue it an access token — which is the first half of
 * every push.
 */
dotenv.config({ path: ['../.env.local', '.env.local'], quiet: true })

const inline = process.env.FCM_SERVICE_ACCOUNT_JSON
if (!inline) {
  console.log('FCM_SERVICE_ACCOUNT_JSON is not set')
  process.exit(1)
}

// The API's own answer, which is what decides whether push is enabled.
console.log('the API accepts it:', isPushConfigured() ? 'yes' : 'NO')

// The same three forms the API tries: the value as it stands, the value
// repaired, and a document that arrived as a string.
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

const read = (value: string): Record<string, unknown> | null => {
  const forms = [value, repair(value)]
  for (const attempt of forms) {
    try {
      const parsed: unknown = JSON.parse(attempt)
      const unwrapped = typeof parsed === 'string' ? JSON.parse(parsed) : parsed
      if (unwrapped && typeof unwrapped === 'object') return unwrapped as Record<string, unknown>
    } catch {
      // The next form.
    }
  }
  // The base64 copy.
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    if (decoded.includes('{')) {
      const parsed: unknown = JSON.parse(decoded)
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    }
  } catch {
    // Not that either.
  }
  return null
}

const account = read(inline)
if (!account) {
  console.log('the service account could not be read')
  process.exit(1)
}

console.log('project_id:    ', account.project_id)
console.log('client_email:  ', account.client_email)
console.log('private_key:  ', account.private_key ? 'present' : 'MISSING')

// The app's own Firebase configuration names the same project; if they
// differ, the token the app gets and the key the API signs with belong to
// different projects and no push can ever arrive.
const google = JSON.parse(
  readFileSync('../android/app/google-services.json', 'utf8').replace(/^﻿/, '')
)
const appProject =
  google.project_info.project_id ??
  google.project_info.projectId ??
  google.project_info.project_number
console.log('the app uses:  ', appProject)
console.log(
  'the same project:',
  appProject === account.project_id || appProject === account.project_id?.replace(/-app$/, '')
    ? 'yes'
    : 'NO — the token and the key belong to different projects'
)

// The access token: a JWT signed with the service account's key, exchanged
// for an access token at Google's token endpoint. This is exactly what
// push.ts does before every send.
const scope = 'https://www.googleapis.com/auth/firebase.messaging'
const now = Math.floor(Date.now() / 1000)
const header = { alg: 'RS256', typ: 'JWT' }
const claim = {
  iss: account.client_email,
  scope,
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
}
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const unsigned = `${b64(header)}.${b64(claim)}`
const signer = createSign('RSA-SHA256')
signer.update(unsigned)
signer.end()
// The key's own line breaks travel escaped, the way the API unescapes them.
const privateKey = (account.private_key as string).replace(/\\n/g, '\n')
const signature = signer.sign(privateKey, 'base64url')
const assertion = `${unsigned}.${signature}`

const response = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  }),
})
const body = await response.json()
if (!response.ok) {
  console.log('the token endpoint refused:', JSON.stringify(body))
  process.exit(1)
}
console.log('access token:  obtained, expires in', body.expires_in, 'seconds')
console.log('\nThe service account works. Give the API the same JSON as FCM_SERVICE_ACCOUNT_JSON.')
