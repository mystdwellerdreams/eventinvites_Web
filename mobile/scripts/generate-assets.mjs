/**
 * Generates the Android launcher, adaptive-icon and splash assets from the
 * web app's own logo, so the native shell carries the same branding.
 *
 * Run it with `npm run android:assets` (or after `npm run android:sync`) and
 * commit the result under android/app/src/main/res.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..', '..')
const logo = join(repo, 'public', 'logo.png')
const res = join(repo, 'android', 'app', 'src', 'main', 'res')

/** Density buckets, as their scale factor over mdpi. */
const DENSITIES = {
  mdpi: 1,
  hdpi: 1.5,
  xhdpi: 2,
  xxhdpi: 3,
  xxxhdpi: 4,
}

/** The exact splash sizes the Capacitor template ships with. */
const SPLASHES = {
  drawable: [480, 320],
  'drawable-land-mdpi': [480, 320],
  'drawable-land-hdpi': [800, 480],
  'drawable-land-xhdpi': [1280, 720],
  'drawable-land-xxhdpi': [1600, 960],
  'drawable-land-xxxhdpi': [1920, 1280],
  'drawable-port-mdpi': [320, 480],
  'drawable-port-hdpi': [480, 800],
  'drawable-port-xhdpi': [720, 1280],
  'drawable-port-xxhdpi': [960, 1600],
  'drawable-port-xxxhdpi': [1280, 1920],
}

const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
const splashBackground = { r: 255, g: 255, b: 255, alpha: 1 }

/** The logo on a transparent canvas, contained in a square. */
async function logoOn(size, cover = 1) {
  const inner = Math.round(size * cover)
  const scaled = await sharp(logo)
    .resize(inner, inner, { fit: 'contain', background: transparent })
    .png()
    .toBuffer()

  if (cover === 1) return scaled

  const offset = Math.round((size - inner) / 2)
  return sharp({ create: { width: size, height: size, channels: 4, background: transparent } })
    .composite([{ input: scaled, left: offset, top: offset }])
    .png()
    .toBuffer()
}

async function write(buffer, ...segments) {
  const target = join(res, ...segments)
  await mkdir(dirname(target), { recursive: true })
  await sharp(buffer).toFile(target)
  console.log('wrote', target.replace(repo + '\\', ''))
}

for (const [density, scale] of Object.entries(DENSITIES)) {
  const dir = `mipmap-${density}`
  // The round icon is masked by the launcher, so it ships the same artwork.
  const square = await logoOn(Math.round(48 * scale))
  await write(square, dir, 'ic_launcher.png')
  await write(square, dir, 'ic_launcher_round.png')
  // The adaptive foreground keeps the artwork inside the safe zone.
  await write(await logoOn(Math.round(108 * scale), 0.62), dir, 'ic_launcher_foreground.png')
}

for (const [dir, [width, height]] of Object.entries(SPLASHES)) {
  const inner = Math.round(Math.min(width, height) * 0.34)
  const mark = await sharp(logo)
    .resize(inner, inner, { fit: 'contain', background: transparent })
    .png()
    .toBuffer()
  const splash = await sharp({
    create: { width, height, channels: 4, background: splashBackground },
  })
    .composite([
      {
        input: mark,
        left: Math.round((width - inner) / 2),
        top: Math.round((height - inner) / 2),
      },
    ])
    .png()
    .toBuffer()
  await write(splash, dir, 'splash.png')
}

console.log('Android assets generated.')
