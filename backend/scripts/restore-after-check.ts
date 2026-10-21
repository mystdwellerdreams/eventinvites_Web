import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { prisma } from '../src/utils/prisma'
import { deleteUpload } from '../src/utils/storage'

dotenv.config({ path: ['../.env.local', '.env.local'], quiet: true })

/**
 * Puts back what an image-upload check changed.
 *
 * The check writes down what it touched before it touches it — the banner's
 * configuration, the account's avatar, and the names of the files it wrote
 * into the store — and this puts exactly that back. Anything else is left
 * alone: a picture a real visitor uploaded a minute ago is not the check's
 * to remove.
 */
const SNAPSHOT = resolve(process.argv[2] ?? '../scripts/.upload-check.json')

interface Snapshot {
  /** The account whose avatar the check replaced. */
  avatar?: { userId: string; value: string | null } | null
  /** The banner the check gave an image. */
  banner?: { adId: string; config: unknown } | null
  /** The names of the files the check wrote into the store. */
  files?: string[]
}

let snapshot: Snapshot = {}
try {
  snapshot = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Snapshot
} catch {
  console.log(`no snapshot at ${SNAPSHOT}; there is nothing to put back`)
}

if (snapshot.avatar?.userId) {
  await prisma.user.update({
    where: { id: snapshot.avatar.userId },
    data: { avatar: snapshot.avatar.value || null },
  })
  console.log('the account carries the avatar it had again')
}

if (snapshot.banner?.adId) {
  // The configuration is a JSON string in the column, so it is written out
  // in full — the way it was before the check gave the banner an image.
  await prisma.bannerAd.update({
    where: { id: snapshot.banner.adId },
    data: { config: JSON.stringify(snapshot.banner.config) },
  })
  console.log('the banner carries the configuration it had again')
}

for (const name of snapshot.files ?? []) {
  try {
    await deleteUpload(name)
  } catch (err) {
    console.log(`could not remove ${name}:`, (err as Error).message)
  }
}
if (snapshot.files?.length) {
  console.log(`removed ${snapshot.files.length} picture(s) the check wrote`)
}

await prisma.$disconnect()
