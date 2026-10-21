import { writeFileSync } from 'node:fs'

/**
 * The steps the image-upload checks share.
 *
 * Two checks run: one against the web app and one against the bundle the
 * Android WebView loads. Both sign in, choose a picture, crop it and then
 * look at what the browser actually drew, so the fiddly parts live here
 * rather than being written twice.
 */

/** The account both checks sign in with. */
export const ADMIN = { identifier: 'admin@example.com', password: 'Admin' }

/** How long a check waits for something to appear, in milliseconds. */
const WAIT_MS = 500

/**
 * The picture the checks upload.
 *
 * It is drawn by the browser itself, so it is a real picture rather than a
 * guess at what a PNG looks like — and a picture that has been drawn is
 * decoded by the browser, so its width proves that the image was loaded.
 */
export async function writeTestPicture(page, path) {
  const dataUrl = await page.evaluate(`(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#3b82f6'
    ctx.fillRect(0, 0, 8, 8)
    return canvas.toDataURL('image/png')
  })()`)
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'))
  return path
}

/**
 * The answer to the app's own challenge, which is arithmetic: the server
 * asks "7 + 5 = ?" and checks the answer against what it asked.
 */
export function answerOf(question) {
  const numbers = String(question).match(/\d+/g)
  if (!numbers || numbers.length < 2) {
    throw new Error(`the challenge is not arithmetic: ${question}`)
  }
  const [a, b] = numbers.map(Number)
  return String(a + b)
}

/** Puts a value into a field the page controls itself. */
export async function fill(page, selector, value) {
  const written = await page.evaluate(`(() => {
    const field = document.querySelector(${JSON.stringify(selector)})
    if (!field) return false
    // React reads the field's own value, so the setter is the native one
    // rather than the property React put there.
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set
    setter.call(field, ${JSON.stringify(value)})
    field.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  if (!written) throw new Error(`no field matched ${selector}`)
}

/**
 * Signs in through the API.
 *
 * This is the web app's way: the session lives in a cookie the browser
 * keeps, so a request made from the page carries it on its own.
 */
export async function signInWithCookie(page, api) {
  const status = await page.evaluate(`(async () => {
    const challenge = await (await fetch(${JSON.stringify(`${api}/api/captcha/fallback`)}, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).json()
    const answer = String(challenge.question)
      .replace(/[^0-9+\\-*]/g, '')
      .split('')
      .reduce((total, operator, index, expression) => {
        if (index === 0) return Number(operator)
        if (operator === '+') return total + Number(expression[index + 1])
        if (operator === '-') return total - Number(expression[index + 1])
        if (operator === '*') return total * Number(expression[index + 1])
        return total
      }, 0)
    const verified = await (await fetch(${JSON.stringify(`${api}/api/captcha/fallback/verify`)}, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: challenge.id, answer: String(answer), action: 'login' }),
    })).json()
    const res = await fetch(${JSON.stringify(`${api}/api/auth/login`)}, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The verified challenge travels in a header, not in the body: the
        // same call has to work for JSON and for multipart uploads.
        'x-captcha-token': verified.token,
      },
      credentials: 'include',
      body: JSON.stringify({
        identifier: ${JSON.stringify(ADMIN.identifier)},
        password: ${JSON.stringify(ADMIN.password)},
      }),
    })
    return res.status
  })()`)
  if (status !== 200) throw new Error(`the sign-in answered ${status}`)
  return 'the session cookie is set'
}

/**
 * Signs in through the app's own form.
 *
 * This is the APK's way: the account is signed in from the page itself, so
 * the app keeps the access token in memory and sends it as a header.
 *
 * The challenge is the Cloudflare widget when it is in force, and the app's
 * own one when the widget cannot be shown. Which of the two it is depends on
 * the site key and the hostnames that key allows, so both are waited for:
 * the widget solves itself, or the question appears to be answered.
 */
export async function signInWithForm(page) {
  // The shell's own sign-in button, which opens the form.
  await page.evaluate(`(() => {
    const button = document.querySelector('.mobile-login-button')
    if (button) button.click()
  })()`)
  await waitFor(page, `Boolean(document.querySelector('#auth-identifier'))`, 'the sign-in form')

  await fill(page, '#auth-identifier', ADMIN.identifier)
  await fill(page, '#auth-password', ADMIN.password)

  let widgetSolvedIt = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await page.evaluate(`(() => ({
      question: document.querySelector('.captcha-fallback-question')?.textContent ?? '',
      solved: Boolean(document.querySelector('.auth-form button[type=submit]:not([disabled])')),
    }))()`)
    // The question only counts once it is a question: the element is there
    // while it is still being fetched.
    if (/\d/.test(state.question) && state.question.includes('=')) break
    if (state.solved) {
      widgetSolvedIt = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
  }

  if (!widgetSolvedIt) {
    const question = await page.evaluate(
      `document.querySelector('.captcha-fallback-question')?.textContent ?? ''`
    )
    if (!/\d/.test(question)) {
      throw new Error(`no challenge appeared in the form (${question})`)
    }
    await fill(page, '.captcha-fallback-input', answerOf(question))
    await page.evaluate(`(() => {
      const button = document.querySelector('.captcha-fallback button')
      if (button) button.click()
    })()`)
    await waitFor(
      page,
      `Boolean(document.querySelector('.auth-form button[type=submit]:not([disabled])'))`,
      'the challenge to be accepted'
    )
  }

  await page.evaluate(`(() => {
    const button = document.querySelector('.auth-form button[type=submit]')
    if (button) button.click()
  })()`)
  await waitFor(page, `!document.querySelector('.auth-overlay')`, 'the form to close')
  return widgetSolvedIt ? 'the widget solved the challenge' : "the app's own challenge was answered"
}

/**
 * Chooses a picture for the avatar and accepts the crop.
 *
 * The picture goes through the cropper, so the file that is uploaded is the
 * cropped one — which is what the app itself does.
 */
export async function uploadTheAvatar(page, filePath) {
  await page.setFileInput('.profile-avatar-section input[type=file]', filePath)
  await waitFor(page, `Boolean(document.querySelector('.avatar-cropper'))`, 'the cropper to open')
  await page.evaluate(`(() => {
    const button = document.querySelector('.avatar-cropper-actions .btn-primary')
    if (button) button.click()
  })()`)
  await waitFor(page, `!document.querySelector('.avatar-cropper')`, 'the crop to be accepted')
}

/** What a picture element is showing: its address and its own width. */
export async function pictureIn(page, selector) {
  return page.evaluate(`(() => {
    const img = document.querySelector(${JSON.stringify(selector)})
    if (!img) return null
    return { src: img.src, width: img.naturalWidth, complete: img.complete }
  })()`)
}

/**
 * Waits for a picture to be drawn.
 *
 * A picture that is off screen is never fetched, and one that is fetched is
 * not necessarily decoded, so the width is what says whether the browser
 * could load it.
 */
export async function waitForPicture(page, selector, attempts = 20) {
  let picture = null
  for (let attempt = 0; attempt < attempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
    picture = await pictureIn(page, selector)
    if (picture?.width > 0) break
  }
  return picture
}

/** Waits for a condition to hold in the page. */
export async function waitFor(page, expression, what, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (await page.evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS))
  }
  throw new Error(`waited for ${what}, which never came`)
}
