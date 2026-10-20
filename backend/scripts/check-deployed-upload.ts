/**
 * Exercises the deployed API the way the app does: the captcha, a sign-in,
 * an upload to the object store and the image coming back through the upload
 * route.
 */
const BASE = 'https://kolymafiaclub.vercel.app'

const post = async (path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// The captcha: the fallback challenge the app uses when the widget cannot
// load, which is also what a server-side test can answer.
const challenge = await post('/api/captcha/fallback')
console.log('challenge:', challenge.status, JSON.stringify(challenge.body))
if (!challenge.body?.id) process.exit(1)

const answer = String(
  String(challenge.body.question)
    .replace(/[^0-9+\-*/]/g, '')
    .split('')
    .reduce((total, operator, index, expression) => {
      if (index === 0) return Number(operator)
      if (operator === '+') return total + Number(expression[index + 1])
      if (operator === '-') return total - Number(expression[index + 1])
      if (operator === '*') return total * Number(expression[index + 1])
      return total
    }, 0)
)
const verified = await post('/api/captcha/fallback/verify', {
  id: challenge.body.id,
  answer,
  action: 'login',
})
console.log('verified:', verified.status, verified.body?.token ? 'a token' : JSON.stringify(verified.body))
if (!verified.body?.token) process.exit(1)

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
const session = signIn.headers.get('set-cookie') ?? ''
console.log('sign-in:', signIn.status, session ? 'a session cookie' : 'no cookie')
if (!signIn.ok) {
  console.log('  body:', (await signIn.text()).slice(0, 200))
  process.exit(1)
}
const cookie = session.split(';')[0]

// The upload, and the image coming back.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const form = new FormData()
form.append('avatar', new Blob([png], { type: 'image/png' }), 'check.png')

const upload = await fetch(`${BASE}/api/upload/avatar`, {
  method: 'POST',
  headers: { cookie },
  body: form,
})
const raw = await upload.text()
console.log('upload:', upload.status, raw.slice(0, 200))
if (!upload.ok) process.exit(1)

const { url } = JSON.parse(raw)
// The browser asks the API for the file by its path; the store's own URL is
// what the database keeps, and the client rewrites it to this.
const path = new URL(url).pathname
const fetched = await fetch(`${BASE}${path}`, { headers: { cookie } })
const bytes = Buffer.from(await fetched.arrayBuffer())
console.log('fetched:', fetched.status, fetched.headers.get('content-type'), bytes.byteLength, 'bytes')
console.log('bytes match:', bytes.equals(png))
