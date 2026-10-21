import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { launchBrowser, openPage } from './browser.mjs'
import {
  ADMIN,
  signInWithForm,
  uploadTheAvatar,
  waitFor,
  waitForPicture,
  writeTestPicture,
} from './upload-checks.mjs'

/**
 * Checks the app the way the Android WebView runs it.
 *
 * The bundle that ships in the APK is built, served from its own origin and
 * given an API on another one, which is the shape it has on a phone: the
 * WebView answers on its own origin and the API lives somewhere else
 * entirely. The app is then made to behave like the native shell, so it
 * signs in the way it does there and keeps the access token in memory.
 *
 * What is checked is what a person would notice: the avatar they choose is
 * stored, linked to their account and shown, and the cover they upload is
 * shown with its preview.
 *
 * The bundle is built into a directory of its own, not into `mobile/www`:
 * this build points at the API the check runs, and the one in `mobile/www`
 * is the one an APK is made from.
 */
const BUNDLE = resolve(tmpdir(), 'eventinvites-app-check')
const PICTURE = resolve('scripts/.upload-check.png')
const SNAPSHOT = resolve('scripts/.upload-check-app.json')

/** TypeScript is run through its own loader, so the checks can use the
 *  backend's own code. */
const TSX = resolve('node_modules/tsx/dist/cli.mjs')
/** The bundler, run the way the build script runs it. */
const VITE = resolve('node_modules/vite/bin/vite.js')

/**
 * The two origins the check runs on: the app's own, and the API's.
 *
 * The app's origin is picked first, because the API has to be told about it
 * before it starts. Both are free ports, so a check never runs into a
 * leftover from an earlier one.
 */
let APP_ORIGIN = ''
let API_ORIGIN = ''
let API_PORT = 0

/** A port nothing is listening on. */
async function freePort() {
  const socket = createSocketServer()
  await new Promise((done) => socket.listen(0, '127.0.0.1', done))
  const { port } = socket.address()
  await new Promise((done) => socket.close(done))
  return port
}

const results = []
async function check(name, fn) {
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

/**
 * The environment the API is started with.
 *
 * The repository's own file wins over the backend's, because it is the one
 * that describes the deployment: the token in it is the store's, so the
 * uploads land in the store rather than on a disk the next request cannot
 * reach.
 */
async function readEnvironment() {
  const env = {}
  for (const file of ['backend/.env', '.env.local']) {
    let text
    try {
      text = await readFile(resolve(file), 'utf8')
    } catch {
      continue
    }
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!match) continue
      env[match[1]] = match[2].trim().replace(/^["']/, '').replace(/["']$/, '')
    }
  }
  return env
}

/** The API the app talks to, started for the check and stopped at the end. */
async function startApi(env) {
  // The loader is run directly rather than through a shell, so that stopping
  // the check stops the API and not the shell around it.
  const child = spawn(process.execPath, [TSX, 'backend/src/index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env,
      PORT: String(API_PORT),
      // The app's own origin has to be allowed, or the WebView's requests
      // are refused before they are made.
      FRONTEND_URL: APP_ORIGIN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.on('exit', (code) => {
    output += `\n[the API stopped with ${code}]\n`
  })
  for (let attempt = 0; attempt < 120; attempt++) {
    if (output.includes('Server running on')) {
      return {
        child,
        get output() {
          return output
        },
      }
    }
    if (child.exitCode !== null) {
      throw new Error(`the API stopped: ${output.slice(-400)}`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  child.kill()
  throw new Error('the API did not start')
}

/**
 * The bundle, served the way the WebView serves it: a file if there is one,
 * and the app's own page for anything else, so a deep link reaches the app.
 */
function serveBundle() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
  }
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    const candidate = join(BUNDLE, normalize(path).replace(/^([/\\])+/, ''))
    const send = async (file, status) => {
      const body = await readFile(file)
      res.writeHead(status, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    }
    try {
      const info = await stat(candidate)
      if (info.isFile()) return await send(candidate, 200)
      if (info.isDirectory()) return await send(join(candidate, 'index.html'), 200)
    } catch {
      // Not a file; the app's own page answers instead.
    }
    try {
      return await send(join(BUNDLE, 'index.html'), 200)
    } catch {
      res.writeHead(404).end('not found')
    }
  })
  return new Promise((done) =>
    server.listen(Number(new URL(APP_ORIGIN).port), () => done(server))
  )
}

/** Signs in over the API and keeps the cookie, the way a browser would. */
async function signInForTheApi() {
  const challenge = await (
    await fetch(`${API_ORIGIN}/api/captcha/fallback`, { method: 'POST' })
  ).json()
  const answer = String(challenge.question)
    .match(/\d+/g)
    .reduce((total, number) => total + Number(number), 0)
  const verified = await (
    await fetch(`${API_ORIGIN}/api/captcha/fallback/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: challenge.id, answer: String(answer), action: 'login' }),
    })
  ).json()
  const signIn = await fetch(`${API_ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The verified challenge travels in a header, not in the body: the
      // same call has to work for JSON and for multipart uploads.
      'x-captcha-token': verified.token,
    },
    body: JSON.stringify({
      identifier: ADMIN.identifier,
      password: ADMIN.password,
    }),
  })
  assert(signIn.ok, `the sign-in answered ${signIn.status}`)
  const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0]
  assert(cookie, 'the sign-in set no session cookie')
  return cookie
}

/** The address the API serves a stored file under. */
function servedPath(stored) {
  return stored.startsWith('http') ? new URL(stored).pathname : stored
}

/** What the API says the account carries. */
async function account(cookie) {
  const me = await fetch(`${API_ORIGIN}/api/auth/me`, { headers: { cookie } })
  return me.json()
}

const env = await readEnvironment()
let api = null
let apiStarted = null
let server = null
let browser = null
let page = null
let cookie = ''
/** What the check touched, so that it can be put back afterwards. */
const snapshot = { avatar: null, files: [] }

try {
  await check('the API is running for the check', async () => {
    // The app's origin is settled first: the API has to be told about it
    // before it starts.
    APP_ORIGIN = `http://localhost:${await freePort()}`
    API_PORT = await freePort()
    API_ORIGIN = `http://localhost:${API_PORT}`

    const started = await startApi(env)
    api = started.child
    apiStarted = started
    let body = null
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const health = await fetch(`${API_ORIGIN}/api/health`)
        body = await health.json()
        break
      } catch (err) {
        if (attempt === 19) {
          throw new Error(
            `${err.message} (${err.cause?.message ?? 'no reason'}); the API says: ${started
              .output.slice(-300)}`
          )
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    assert(body?.status === 'ok', `the API is ${body?.status}`)
    return `storage ${body.storage}`
  })

  await check('the bundle is built for the API', async () => {
    if (process.env.CHECK_APP_SKIP_BUILD === '1') {
      return 'the build was skipped'
    }
    execFileSync(
      process.execPath,
      [VITE, 'build', '--config', 'mobile/vite.config.ts', '--outDir', BUNDLE, '--emptyOutDir'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          // The app names the API in full, because the two live on different
          // origins. The captcha's site key is the one the environment
          // carries, so the bundle is the one that will be shipped.
          VITE_API_BASE: `${API_ORIGIN}/api`,
        },
        stdio: 'ignore',
      }
    )
    return 'the APK bundle is up to date'
  })

  await check('the app is served from its own origin', async () => {
    server = await serveBundle()
    const response = await fetch(`${APP_ORIGIN}/`)
    assert(response.ok, `the bundle answered ${response.status}`)
    return APP_ORIGIN
  })

  await check('the app loads', async () => {
    browser = await launchBrowser()
    page = await openPage(`${APP_ORIGIN}/`, {
      // The bridge is what makes Capacitor report a native platform, so the
      // app signs in the way it does on a phone: with a token it keeps,
      // rather than with a cookie.
      initScript: 'window.androidBridge = {}',
    })
    const title = await page.evaluate('document.title')
    assert(title, 'the page has no title')
    return title
  })

  await check('the API knows who is signed in', async () => {
    // The account is written down before anything can change it, so that the
    // check can put the avatar it finds back afterwards — even when a later
    // step fails.
    cookie = await signInForTheApi()
    const me = await account(cookie)
    assert(me.user?.id, 'the API did not answer with an account')
    snapshot.avatar = { userId: me.user.id, value: me.user.avatar ?? null }
    return me.user.email
  })

  await check('an administrator can sign in', async () => {
    const detail = await signInWithForm(page)
    await waitFor(page, `Boolean(document.querySelector('.user-avatar-box'))`, 'the signed-in shell')
    return detail
  })

  await check('an uploaded avatar is stored and linked to the account', async () => {
    await page.goto(`${APP_ORIGIN}/profile`)
    await waitFor(
      page,
      `Boolean(document.querySelector('.profile-avatar-section input[type=file]'))`,
      'the profile page'
    )
    await writeTestPicture(page, PICTURE)
    await uploadTheAvatar(page, PICTURE)

    // The picture the app is showing is the file this check wrote, whether
    // or not the API can be asked about the account — the name is taken
    // from the page first, so that a failure elsewhere still leaves the
    // store as it was.
    const shown = await waitForPicture(page, '.profile-avatar img')
    const fromPage = shown?.src?.split('/').pop() ?? ''

    // The account carries the address the store gave.
    const me = await account(cookie)
    const stored = me.user?.avatar ?? ''
    const name = (stored ? servedPath(stored) : fromPage).split('/').pop()
    if (name) snapshot.files.push(name)
    assert(stored, 'the account carries no avatar')
    // The store serves it through the API, under the path the app uses.
    const served = await fetch(`${API_ORIGIN}${servedPath(stored)}`)
    assert(served.ok, `the picture came back ${served.status}`)
    assert(
      (served.headers.get('content-type') ?? '').startsWith('image/'),
      `the picture came back as ${served.headers.get('content-type')}`
    )
    return stored.split('/').pop()
  })

  await check('the profile page shows the avatar', async () => {
    const picture = await waitForPicture(page, '.profile-avatar img')
    assert(picture, 'the profile shows no avatar')
    assert(picture.width > 0, `the avatar did not load (${picture.src})`)
    assert(
      picture.src.startsWith(`${API_ORIGIN}/uploads/`),
      `the avatar points at the store rather than the API: ${picture.src}`
    )
    return picture.src.replace(API_ORIGIN, '')
  })

  await check('the shell shows the avatar', async () => {
    const picture = await waitForPicture(page, '.user-avatar-box img')
    assert(picture, 'the shell shows no avatar')
    assert(picture.width > 0, `the avatar did not load (${picture.src})`)
    assert(
      picture.src.startsWith(`${API_ORIGIN}/uploads/`),
      `the avatar points at the store rather than the API: ${picture.src}`
    )
    return picture.src.replace(API_ORIGIN, '')
  })

  await check('an uploaded cover image appears in the editor', async () => {
    await page.goto(`${APP_ORIGIN}/admin/events/new`)
    await waitFor(
      page,
      `Boolean(document.querySelector('.cover-images-upload input[type=file]'))`,
      'the event editor'
    )
    await writeTestPicture(page, PICTURE)
    await page.setFileInput('.cover-images-upload input[type=file]', PICTURE)

    // The upload lands in the field, and the address it puts there is the
    // file this check wrote.
    let uploaded = ''
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      uploaded = await page.evaluate(
        `document.querySelector('.cover-images-fields input[type=text]')?.value ?? ''`
      )
      if (uploaded) break
    }
    assert(uploaded, 'the upload did not reach the field')

    await waitFor(
      page,
      `Boolean(document.querySelector('.cover-images-thumb img'))`,
      'the cover preview'
    )
    // The thumbnail is loaded lazily, so it is brought into view before it is
    // read: a picture that is off screen is never fetched, and never decoded.
    await page.evaluate(`(() => {
      document.querySelector('.cover-images-thumb')?.scrollIntoView({ block: 'center' })
    })()`)
    const preview = await waitForPicture(page, '.cover-images-thumb img')
    assert(preview, 'the editor shows no preview')
    // The file is written down before anything is asserted, so that a check
    // that fails still takes its picture with it.
    snapshot.files.push(uploaded.split('/').pop())
    assert(preview.width > 0, `the preview did not load (${preview.src})`)
    assert(
      preview.src.startsWith(`${API_ORIGIN}/uploads/`),
      `the preview points at the store rather than the API: ${preview.src}`
    )
    assert(
      preview.src.includes(uploaded.split('/').pop()),
      `the preview shows ${preview.src}, but the field holds ${uploaded}`
    )
    return preview.src.replace(API_ORIGIN, '')
  })

  await check('the event preview shows the cover', async () => {
    // The editor hands its draft to the event page, which shows the cover
    // the administrator uploaded.
    const opened = await page.evaluate(`(() => {
      const buttons = [...document.querySelectorAll('button')]
      const preview = buttons.find(
        (button) => (button.textContent ?? '').trim() === 'View Page'
      )
      if (!preview) return false
      preview.click()
      return true
    })()`)
    assert(opened, 'the editor has no preview button')
    await new Promise((r) => setTimeout(r, 2000))
    const picture = await waitForPicture(page, '.ep-carousel-image, .ep-cover')
    assert(picture, 'the preview shows no cover')
    assert(picture.width > 0, `the cover did not load (${picture.src})`)
    assert(
      picture.src.startsWith(`${API_ORIGIN}/uploads/`),
      `the cover points at the store rather than the API: ${picture.src}`
    )
    return picture.src.replace(API_ORIGIN, '')
  })
} finally {
  // What the check changed is put back, so the store and the account are as
  // they were.
  try {
    await writeFile(SNAPSHOT, JSON.stringify(snapshot, null, 2))
    execFileSync(
      process.execPath,
      [TSX, 'scripts/restore-after-check.ts', '../scripts/.upload-check-app.json'],
      {
        cwd: resolve('backend'),
        stdio: 'inherit',
      }
    )
  } catch (err) {
    console.log('could not put the account and the store back:', err.message)
  }
  page?.close()
  browser?.close()
  server?.close()
  api?.kill()
  if (process.env.CHECK_APP_VERBOSE === '1' && apiStarted) {
    console.log('--- the API said ---')
    console.log(apiStarted.output.slice(-1500))
  }
}

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
