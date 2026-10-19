/**
 * Checks the upload store the way the app uses it: one file is written, read
 * back and removed.
 *
 * With several stores available at once — a local disk, Vercel Blob and an
 * S3-compatible bucket — this says which one is in use and whether a file
 * survives the round trip, which is what a fresh deployment needs to know
 * before a user uploads an avatar.
 *
 * Run it with: npm run storage:check --workspace=backend
 */
import { saveUpload, resolveUpload, deleteUpload, checkStorage } from '../src/utils/storage'
import type { Express } from 'express'

/** A one-pixel PNG, so the round trip exercises the real image path. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

async function main(): Promise<void> {
  const reachable = await checkStorage()
  console.log('store reachable:', reachable)
  if (!reachable) {
    console.error('The configured upload store did not answer.')
    process.exitCode = 1
    return
  }

  const file = {
    buffer: PIXEL,
    mimetype: 'image/png',
    originalname: 'storage-check.png',
    size: PIXEL.byteLength,
  } as Express.Multer.File

  const saved = await saveUpload(file)
  console.log('saved as:', saved.url)

  const filename = saved.url.split('/').pop() as string
  const resolved = await resolveUpload(filename)
  if (!resolved) {
    console.error('The file was written but could not be read back.')
    process.exitCode = 1
    return
  }

  const body = resolved.body
  const identical = body ? body.equals(PIXEL) : false
  console.log('read back:', resolved.redirectTo ? `redirect to ${resolved.redirectTo}` : `${body?.byteLength} bytes`)
  console.log('content type:', resolved.contentType)
  console.log('bytes match:', identical)

  await deleteUpload(filename)
  const afterDelete = await resolveUpload(filename)
  console.log('gone after delete:', afterDelete === null)

  if (!identical || afterDelete !== null) {
    console.error('The round trip did not behave as expected.')
    process.exitCode = 1
    return
  }
  console.log('OK')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
