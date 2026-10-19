import { readFileSync } from 'node:fs'
import jwt from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

/**
 * Exercises the Worker the way the app does: the SPA, a deep link, a real API
 * call, and an upload that comes back through the upload route.
 */
const BASE = 'http://127.0.0.1:8787'

const source = readFileSync('.env.local', 'utf8')
const value = (name) => {
  const line = source.split(/\r?\n/).find((l) => l.startsWith(`${name}=`))
  return line ? line.slice(name.length + 1).trim().replace(/^["']/, '').replace(/["']$/, '') : undefined
}

// A real user, because the auth middleware reads the row the token names.
const db = new pg.Client({ connectionString: value('DATABASE_URL') })
await db.connect()
const { rows } = await db.query('SELECT id, email, role FROM "User" ORDER BY "createdAt" LIMIT 1')
await db.end()
if (!rows.length) throw new Error('The database has no user to test with')
const user = rows[0]

const token = jwt.sign(
  { id: user.id, email: user.email, role: user.role, jti: randomUUID() },
  value('JWT_SECRET'),
  { expiresIn: '15m' }
)

async function check(name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    console.log(`  PASS  ${name} (${Date.now() - started}ms)${detail ? ` - ${detail}` : ''}`)
    return true
  } catch (err) {
    console.log(`  FAIL  ${name} (${Date.now() - started}ms) - ${err.message}`)
    return false
  }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const results = []

results.push(
  await check('GET / serves the app', async () => {
    const res = await fetch(`${BASE}/`)
    assert(res.status === 200, `status ${res.status}`)
    const body = await res.text()
    assert(body.includes('id="root"'), 'no root element')
    return 'single-page app'
  })
)

results.push(
  await check('GET /events/key/abc falls back to the app', async () => {
    const res = await fetch(`${BASE}/events/key/abc`)
    assert(res.status === 200, `status ${res.status}`)
    const body = await res.text()
    assert(body.includes('id="root"'), 'no root element')
    return 'deep link resolved'
  })
)

results.push(
  await check('GET /api/health is healthy', async () => {
    const res = await fetch(`${BASE}/api/health`)
    const body = await res.json()
    assert(res.status === 200, `status ${res.status} ${JSON.stringify(body)}`)
    assert(body.database === 'ok', `database ${body.database}`)
    assert(body.storageReady === 'ok', `storage ${body.storageReady}`)
    return `runtime ${body.runtime}, storage ${body.storage}`
  })
)

results.push(
  await check('GET /api/events answers with data', async () => {
    const res = await fetch(`${BASE}/api/events`)
    assert(res.status === 200, `status ${res.status}`)
    const body = await res.json()
    const count = Array.isArray(body) ? body.length : (body.events?.length ?? '?')
    return `${count} events`
  })
)

results.push(
  await check('POST /api/upload/avatar stores and serves the file', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
    const form = new FormData()
    form.append('avatar', new Blob([png], { type: 'image/png' }), 'check.png')
    const upload = await fetch(`${BASE}/api/upload/avatar`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    const raw = await upload.text()
    assert(upload.status === 200, `upload status ${upload.status}: ${raw}`)
    const { url } = JSON.parse(raw)
    assert(typeof url === 'string' && url.startsWith('/uploads/'), `unexpected url ${url}`)
    const filename = url.split('/').pop()

    const fetched = await fetch(`${BASE}${url}`)
    assert(fetched.status === 200, `fetch status ${fetched.status}`)
    const bytes = Buffer.from(await fetched.arrayBuffer())
    assert(bytes.equals(png), 'the bytes differ')

    // The file is removed again, so a check leaves nothing behind.
    const { S3Client, DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const store = new S3Client({
      endpoint: value('AWS_ENDPOINT_URL_S3'),
      region: value('AWS_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: value('AWS_ACCESS_KEY_ID'),
        secretAccessKey: value('AWS_SECRET_ACCESS_KEY'),
      },
    })
    await store.send(
      new DeleteObjectCommand({
        Bucket: value('NEON_STORAGE_BUCKET'),
        Key: `uploads/${filename}`,
      })
    )

    return `${url} round-tripped and cleaned up`
  })
)

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
