import dotenv from 'dotenv'
import pg from 'pg'

/**
 * Exercises the deployed API the way the app does: the captcha, a sign-in,
 * an upload for each kind of image, the device registration, and the push
 * test that tells a tester whether the whole chain works.
 */
const BASE = process.env.CHECK_BASE ?? 'https://kolymafiaclub.vercel.app'

dotenv.config({ path: ['../.env.local', '.env.local'], quiet: true })
const value = (name) => process.env[name]?.trim().replace(/^["']/, '').replace(/["']$/, '')

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const results = []
const check = async (name, fn) => {
  const started = Date.now()
  try {
    const detail = await fn()
    results.push(true)
    console.log(`  PASS  ${name} (${Date.now() - started}ms)${detail ? ` - ${detail}` : ''}`)
  } catch (err) {
    results.push(false)
    console.log(`  FAIL  ${name} (${Date.now() - started}ms) - ${err.message}`)
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const post = async (path, body, cookie) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// The captcha: the fallback challenge the app uses when the widget cannot
// load, which is also what a server-side test can answer.
const challenge = await post('/api/captcha/fallback')
assert(challenge.body?.id, `the captcha answered ${JSON.stringify(challenge.body)}`)
const answer = String(challenge.body.question)
  .replace(/[^0-9+\-*/]/g, '')
  .split('')
  .reduce((total, operator, index, expression) => {
    if (index === 0) return Number(operator)
    if (operator === '+') return total + Number(expression[index + 1])
    if (operator === '-') return total - Number(expression[index + 1])
    if (operator === '*') return total * Number(expression[index + 1])
    return total
  }, 0)
const verified = await post('/api/captcha/fallback/verify', {
  id: challenge.body.id,
  answer: String(answer),
  action: 'login',
})
assert(verified.body?.token, `the captcha answered ${JSON.stringify(verified.body)}`)

// The sign-in, keeping the session cookie the way a browser would.
const signIn = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    identifier: 'admin@example.com',
    password: 'Admin',
    captchaToken: verified.body.token,
  }),
})
assert(signIn.ok, `the sign-in answered ${signIn.status}: ${(await signIn.text()).slice(0, 200)}`)
const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0]
assert(cookie, 'the sign-in set no session cookie')

/** Uploads one image and reads it back through the route the browser uses. */
const upload = async (path, field) => {
  const form = new FormData()
  form.append(field, new Blob([PNG], { type: 'image/png' }), 'image.png')
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  })
  const raw = await res.text()
  assert(res.ok, `the upload answered ${res.status}: ${raw.slice(0, 200)}`)
  const { url } = JSON.parse(raw)
  assert(url, 'the upload returned no url')

  // The browser asks the API for the file by its path.
  const fetched = await fetch(`${BASE}${new URL(url).pathname}`, { headers: { cookie } })
  assert(fetched.ok, `the image came back ${fetched.status}`)
  const bytes = Buffer.from(await fetched.arrayBuffer())
  assert(bytes.equals(PNG), 'the bytes differ')
  return url
}

await check('an avatar uploads and comes back', async () => {
  const url = await upload('/api/upload/avatar', 'avatar')
  return url.split('/').pop()
})

await check('an event cover uploads and comes back', async () => {
  const url = await upload('/api/upload/cover', 'cover')
  return url.split('/').pop()
})

await check('a banner image uploads and comes back', async () => {
  // The banner editor uses the same route as the cover.
  const url = await upload('/api/upload/cover', 'cover')
  return url.split('/').pop()
})

await check('a device registers itself', async () => {
  const token = `check-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const res = await fetch(`${BASE}/api/devices`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ token, platform: 'android', appVersion: '1.0.0-beta.1' }),
  })
  const body = await res.json().catch(() => null)
  assert(res.ok, `the registration answered ${res.status}: ${JSON.stringify(body)}`)

  // The device is removed again, so the check leaves nothing behind.
  const removed = await fetch(`${BASE}/api/devices`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ token }),
  })
  assert(removed.ok, `the removal answered ${removed.status}`)
  return 'and removes itself'
})

await check('the push chain answers', async () => {
  const res = await fetch(`${BASE}/api/devices/test`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: '{}',
  })
  const body = await res.json().catch(() => null)
  assert(res.ok, `the push test answered ${res.status}: ${JSON.stringify(body)}`)
  assert(body?.configured, 'no service account is configured on the API')
  return `configured, ${body.devices} device(s) registered`
})

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
