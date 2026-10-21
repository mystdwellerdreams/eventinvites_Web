import { writeFileSync } from 'node:fs'
import { launchBrowser, openPage } from './browser.mjs'

/**
 * Checks the image uploads the way an administrator meets them: the file is
 * chosen, the upload runs, and the picture appears.
 *
 * A preview is only worth having if the browser can actually load it, so the
 * check reads the picture's own width rather than trusting that an <img> tag
 * was rendered.
 */
// The origin has to be the one the dev server names: Next.js blocks its
// own dev resources for any other host, and the page would never take over.
const BASE = process.env.CHECK_BASE ?? 'http://localhost:3000'

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

const browser = await launchBrowser()
const page = await openPage(`${BASE}/`)

// The address the banner's picture is stored under, once the editor has it.
let bannerImage = ''

// The picture is drawn by the browser itself, so it is a real image rather
// than a guess at what a PNG looks like.
const dataUrl = await page.evaluate(`(() => {
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3b82f6'
  ctx.fillRect(0, 0, 8, 8)
  return canvas.toDataURL('image/png')
})()`)
const imagePath = `${process.cwd()}/scripts/.upload-check.png`
writeFileSync(imagePath, Buffer.from(dataUrl.split(',')[1], 'base64'))

try {
  await check('the app loads', async () => {
    const title = await page.evaluate('document.title')
    assert(title, 'the page has no title')
    return title
  })

  await check('an administrator can sign in', async () => {
    const status = await page.evaluate(`(async () => {
      const challenge = await (await fetch('/api/captcha/fallback', {
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
      const verified = await (await fetch('/api/captcha/fallback/verify', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: challenge.id, answer: String(answer), action: 'login' }),
      })).json()
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: 'admin@example.com', password: 'Admin', captchaToken: verified.token }),
      })
      return res.status
    })()`)
    assert(status === 200, `the sign-in answered ${status}`)
    return 'the session cookie is set'
  })

  await check('an uploaded cover image appears in the editor', async () => {
    await page.goto(`${BASE}/admin/events/new`)
    await new Promise((resolve) => setTimeout(resolve, 2500))

    await page.setFileInput('.cover-images-upload input[type=file]', imagePath)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    // The thumbnail is loaded lazily, so it is brought into view before it is
    // read: a picture that is off screen is never fetched, and never decoded.
    await page.evaluate(`(() => {
      document.querySelector('.cover-images-thumb')?.scrollIntoView({ block: 'center' })
    })()`)

    let preview = null
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      preview = await page.evaluate(`(() => {
        const img = document.querySelector('.cover-images-thumb img')
        if (!img) return null
        return { src: img.src, width: img.naturalWidth, complete: img.complete }
      })()`)
      if (preview?.width > 0) break
    }

    assert(preview, 'the editor shows no preview')
    assert(preview.width > 0, `the preview did not load (${preview.src})`)
    assert(
      preview.src.includes('/uploads/'),
      `the preview points at the store rather than the API: ${preview.src}`
    )
    return preview.src.replace(/^https?:\/\/[^/]+/, '')
  })

  await check('the saved cover image is what the event page shows', async () => {
    // The value in the field is what gets saved, so it has to be the one the
    // API will serve.
    const value = await page.evaluate(
      `document.querySelector('.cover-images-fields input[type=text]')?.value ?? ''`
    )
    assert(value, 'the field is empty after the upload')
    const src = await page.evaluate(
      `document.querySelector('.cover-images-thumb img')?.getAttribute('src') ?? ''`
    )
    assert(src.includes('/uploads/'), `the preview points at the store: ${src}`)
    return `${value.slice(0, 60)}…`
  })

  await check('a banner image appears in the banner editor', async () => {
    // The banner is given an image background first, the way a saved one
    // carries it: the image field belongs to an image banner, and the choice
    // is a controlled one that will not move from a synthetic click. The main
    // slot is the one the editor opens on.
    const prepared = await page.evaluate(`(async () => {
      const listed = await (await fetch('/api/admin/banners')).json()
      const slots = listed.slots ?? []
      const main = slots.find((slot) => slot.slot === 'MAIN') ?? slots[0]
      const ad = (main?.ads ?? [])[0]
      if (!ad) return 'no banner'
      const res = await fetch('/api/admin/banners/' + ad.id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...ad,
          config: { ...ad.config, backgroundType: 'image' },
        }),
      })
      return res.ok ? 'ok' : 'refused'
    })()`)
    assert(prepared === 'ok', `the banner could not be prepared: ${prepared}`)

    await page.goto(`${BASE}/admin?tab=banners`)
    await new Promise((resolve) => setTimeout(resolve, 3000))

    // The page is compiled on demand and the tab fills in afterwards, so
    // the ad is waited for before it is clicked.
    let items = 0
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      items = await page.evaluate(
        `document.querySelectorAll('.banner-preview-item').length`
      )
      if (items > 0) break
    }
    assert(items > 0, 'the banners tab shows no ads')

    // The item is clicked once: clicking it again would close the form.
    await page.evaluate(`(() => {
      const item = document.querySelector('.banner-preview-item')
      if (item) item.click()
    })()`)
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      const open = await page.evaluate(
        `Boolean(document.querySelector('#banner-ad-form input[type=file]'))`
      )
      if (open) break
    }
    const form = await page.evaluate(`(() => ({
      form: Boolean(document.getElementById('banner-ad-form')),
      inputs: document.querySelectorAll('#banner-ad-form input[type=file]').length,
    }))()`)
    assert(
      form.inputs > 0,
      `the banner form has no file input (form ${form.form})`
    )

    await page.setFileInput('#banner-ad-form input[type=file]', imagePath)
    await new Promise((resolve) => setTimeout(resolve, 1500))

    await page.evaluate(`(() => {
      document.querySelector('#banner-ad-form .cover-images-thumb')?.scrollIntoView({ block: 'center' })
    })()`)

    let preview = null
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      preview = await page.evaluate(`(() => {
        const img = document.querySelector('#banner-ad-form .cover-images-thumb img')
        if (!img) return null
        return { src: img.src, width: img.naturalWidth }
      })()`)
      if (preview?.width > 0) break
    }

    assert(preview, 'the banner editor shows no preview')
    assert(preview.width > 0, `the banner preview did not load (${preview.src})`)
    assert(
      preview.src.includes('/uploads/'),
      `the banner preview points at the store rather than the API: ${preview.src}`
    )

    // The banner is saved, so that a visitor sees the picture rather than
    // only the editor.
    await page.evaluate(`(() => {
      const save = [...document.querySelectorAll('#banner-ad-form button')]
        .find((button) => button.className.includes('btn-primary'))
      if (save) save.click()
    })()`)
    await new Promise((resolve) => setTimeout(resolve, 3000))

    const saved = await page.evaluate(`(() => {
      const input = document.querySelector('#banner-ad-form .banner-image-field input[type=text]')
      return input ? input.value : ''
    })()`)
    assert(saved.includes('blob.vercel-storage.com'), `the banner did not keep the image: ${saved}`)

    // The address the database holds, which is what a visitor's page will
    // have to turn into something the browser can load.
    bannerImage = saved
    return preview.src.replace(/^https?:\/\/[^/]+/, '')
  })

  await check('a visitor sees the banner image', async () => {
    // The banner carries the picture the editor uploaded, the way a saved one
    // does, and the home page is then asked to show it.
    const saved = await page.evaluate(`(async (image) => {
      const listed = await (await fetch('/api/admin/banners')).json()
      const slots = listed.slots ?? []
      const main = slots.find((slot) => slot.slot === 'MAIN') ?? slots[0]
      const ad = (main?.ads ?? [])[0]
      if (!ad) return 'no banner'
      const res = await fetch('/api/admin/banners/' + ad.id, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...ad,
          config: { ...ad.config, backgroundType: 'image', imageUrl: image },
        }),
      })
      return res.ok ? 'the banner carries the image' : 'the banner was refused'
    })(${JSON.stringify(bannerImage)})`)
    assert(saved === 'the banner carries the image', saved)

    await page.goto(`${BASE}/`)
    await new Promise((resolve) => setTimeout(resolve, 2500))

    const background = await page.evaluate(`(() => {
      for (const el of document.querySelectorAll('*')) {
        const image = getComputedStyle(el).backgroundImage
        if (image && image.includes('/uploads/')) return image
      }
      return ''
    })()`)
    if (!background) {
      const banners = await page.evaluate(`(async () => {
        const listed = await (await fetch('/api/banners')).json()
        return JSON.stringify(listed.slots ?? [])
      })()`)
      throw new Error(`no banner on the page carries an uploaded image; the page says ${banners}`)
    }
    const url = background.match(/url\("?([^")]+)"?\)/)?.[1] ?? ''
    assert(url.includes('/uploads/'), `the banner points at the store: ${url}`)
    const status = await page.evaluate(`fetch(${JSON.stringify(url)}).then((r) => r.status)`)
    assert(status === 200, `the banner image answered ${status}`)
    return url.replace(/^https?:\/\/[^/]+/, '')
  })
} finally {
  // The check gives a banner an image, and writes a picture of its own into
  // the store; both are put back.
  try {
    const { execFileSync } = await import('node:child_process')
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    execFileSync(npx, ['tsx', 'scripts/restore-after-check.ts'], {
      cwd: `${process.cwd()}/backend`,
      stdio: 'inherit',
      shell: true,
    })
  } catch (err) {
    console.log('could not put the banner back:', err.message)
  }
  page.close()
  browser.close()
}

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
