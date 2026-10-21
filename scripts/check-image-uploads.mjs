import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchBrowser, openPage } from './browser.mjs'
import {
  signInWithCookie,
  uploadTheAvatar,
  waitFor,
  waitForPicture,
  writeTestPicture,
} from './upload-checks.mjs'

/**
 * Checks the image uploads the way an administrator meets them: the file is
 * chosen, the upload runs, and the picture appears.
 *
 * A preview is only worth having if the browser can actually load it, so the
 * check reads the picture's own width rather than trusting that an <img> tag
 * was rendered.
 *
 * The avatar is checked the way the cover is: the file is chosen, cropped,
 * uploaded, and the account is left carrying the address the store gave —
 * which the app then shows, on the profile page and in the shell.
 */
// The origin has to be the one the dev server names: Next.js blocks its
// own dev resources for any other host, and the page would never take over.
const BASE = process.env.CHECK_BASE ?? 'http://localhost:3000'
const PICTURE = resolve('scripts/.upload-check.png')
const SNAPSHOT = resolve('scripts/.upload-check.json')

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

/** What the check touched, so that it can be put back afterwards. */
const snapshot = { avatar: null, banner: null, files: [] }

/** The banner the check gives an image, and the configuration it had. */
async function theBanner() {
  const listed = await page.evaluate(`(async () => {
    const res = await fetch('/api/admin/banners')
    const body = await res.json()
    const slots = body.slots ?? []
    const main = slots.find((slot) => slot.slot === 'MAIN') ?? slots[0]
    const ad = (main?.ads ?? [])[0]
    return ad ? { id: ad.id, slot: main.slot, config: ad.config } : null
  })()`)
  return listed
}

try {
  await check('the app loads', async () => {
    const title = await page.evaluate('document.title')
    assert(title, 'the page has no title')
    return title
  })

  await check('an administrator can sign in', async () => {
    const detail = await signInWithCookie(page, BASE)
    return detail
  })

  await check('the account and the banner are written down', async () => {
    // What the check is about to change is written down first, so that the
    // account and the banner can be put back exactly as they were.
    const me = await page.evaluate(`(async () => {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      const body = await res.json()
      return body.user ? { id: body.user.id, avatar: body.user.avatar ?? null } : null
    })()`)
    assert(me, 'the API did not answer with an account')
    snapshot.avatar = { userId: me.id, value: me.avatar }

    const banner = await theBanner()
    assert(banner, 'there is no banner to give an image')
    snapshot.banner = { adId: banner.id, config: banner.config }
    return `the banner in the ${banner.slot} slot`
  })

  await check('an uploaded cover image appears in the editor', async () => {
    await page.goto(`${BASE}/admin/events/new`)
    await new Promise((resolve) => setTimeout(resolve, 2500))

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
    // The file is written down before anything is asserted, so that a check
    // that fails still takes its picture with it.
    snapshot.files.push(uploaded.split('/').pop())
    assert(preview.width > 0, `the preview did not load (${preview.src})`)
    assert(
      preview.src.includes('/uploads/'),
      `the preview points at the store rather than the API: ${preview.src}`
    )
    return preview.src.replace(/^https?:\/\/[^/]+/, '')
  })

  await check('the saved cover image is what the event page shows', async () => {
    // The value in the field is what gets saved, so it has to be the one the
    // API will serve — and the preview has to be showing that same file.
    const value = await page.evaluate(
      `document.querySelector('.cover-images-fields input[type=text]')?.value ?? ''`
    )
    assert(value, 'the field is empty after the upload')
    const src = await page.evaluate(
      `document.querySelector('.cover-images-thumb img')?.getAttribute('src') ?? ''`
    )
    assert(src.includes('/uploads/'), `the preview points at the store: ${src}`)
    assert(
      src.includes(value.split('/').pop()),
      `the preview shows ${src}, but the field holds ${value}`
    )
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

    // What the field held before the upload: the picture the ad carried.
    const before = await page.evaluate(
      `document.querySelector('#banner-ad-form .banner-image-field input[type=text]')?.value ?? ''`
    )

    await page.setFileInput('#banner-ad-form input[type=file]', PICTURE)

    // The upload lands in the field, and the address it puts there is the
    // file this check wrote — not the one the ad carried before, which the
    // preview still shows until the upload is through.
    let uploaded = ''
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      uploaded = await page.evaluate(
        `document.querySelector('#banner-ad-form .banner-image-field input[type=text]')?.value ?? ''`
      )
      if (uploaded && uploaded !== before) break
    }
    assert(uploaded && uploaded !== before, 'the upload did not reach the field')

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
      if (preview?.width > 0 && preview.src.includes(uploaded.split('/').pop())) break
    }

    assert(preview, 'the banner editor shows no preview')
    // The file is written down before anything is asserted, so that a check
    // that fails still takes its picture with it.
    snapshot.files.push(uploaded.split('/').pop())
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

  await check('an uploaded avatar is stored and linked to the account', async () => {
    await page.goto(`${BASE}/profile`)
    await waitFor(
      page,
      `Boolean(document.querySelector('.profile-avatar-section input[type=file]'))`,
      'the profile page'
    )
    await writeTestPicture(page, PICTURE)
    await uploadTheAvatar(page, PICTURE)

    // The picture the page is showing is the file this check wrote, whether
    // or not the account can be asked about it — so that a failure
    // elsewhere still leaves the store as it was.
    const shown = await waitForPicture(page, '.profile-avatar img')
    const fromPage = shown?.src?.split('/').pop() ?? ''

    // The account carries the address the store gave.
    const stored = await page.evaluate(`(async () => {
      const res = await fetch('/api/auth/me', { credentials: 'include' })
      const body = await res.json()
      return body.user?.avatar ?? ''
    })()`)
    const path = stored
      ? stored.startsWith('http')
        ? new URL(stored).pathname
        : stored
      : `/${fromPage}`
    // The file is written down before anything is asserted, so that a check
    // that fails still takes its picture with it.
    if (path.split('/').pop()) snapshot.files.push(path.split('/').pop())
    assert(stored, 'the account carries no avatar')

    // The store serves it through the API, under the path the app uses.
    const status = await page.evaluate(
      `fetch(${JSON.stringify(path)}).then((r) => r.status)`
    )
    assert(status === 200, `the picture came back ${status}`)
    return stored.split('/').pop()
  })

  await check('the profile page shows the avatar', async () => {
    const picture = await waitForPicture(page, '.profile-avatar img')
    assert(picture, 'the profile shows no avatar')
    assert(picture.width > 0, `the avatar did not load (${picture.src})`)
    assert(
      picture.src.includes('/uploads/'),
      `the avatar points at the store rather than the API: ${picture.src}`
    )
    return picture.src.replace(/^https?:\/\/[^/]+/, '')
  })

  await check('the shell shows the avatar', async () => {
    const picture = await waitForPicture(page, '.user-avatar-box img')
    assert(picture, 'the shell shows no avatar')
    assert(picture.width > 0, `the avatar did not load (${picture.src})`)
    assert(
      picture.src.includes('/uploads/'),
      `the avatar points at the store rather than the API: ${picture.src}`
    )
    return picture.src.replace(/^https?:\/\/[^/]+/, '')
  })
} finally {
  // What the check changed is put back: the account carries the avatar it
  // had, the banner carries the configuration it had, and the pictures the
  // check wrote are removed from the store. A picture a real visitor
  // uploaded is not the check's to remove.
  try {
    writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 2))
    execFileSync(
      process.execPath,
      [
        resolve('node_modules/tsx/dist/cli.mjs'),
        'scripts/restore-after-check.ts',
        '../scripts/.upload-check.json',
      ],
      { cwd: resolve('backend'), stdio: 'inherit' }
    )
  } catch (err) {
    console.log('could not put the account and the store back:', err.message)
  }
  page.close()
  browser.close()
}

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exitCode = passed === results.length ? 0 : 1
