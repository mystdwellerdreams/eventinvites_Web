import dotenv from 'dotenv'
import { list, del } from '@vercel/blob'
import { prisma } from '../src/utils/prisma'

dotenv.config({ path: ['../.env.local', '.env.local'], quiet: true })

/**
 * Puts back what the image-upload check changed: the cover banner's
 * background, and the pictures the check wrote into the store.
 *
 * The banner's configuration is a JSON string in the column, so it is written
 * out in full — the way it was before the check gave it an image.
 */
const ad = await prisma.bannerAd.findFirst({ where: { type: 'COVER' } })
if (ad) {
  const config = {
    backgroundType: 'gradient',
    gradientFrom: '#3b82f6',
    gradientTo: '#8b5cf6',
    text: 'Kolymafia Club - #1 в Магадане',
    alignment: 'left',
    fontColor: '#d4dde4',
    description: '',
    verticalAlignment: 'bottom',
    descriptionAlignment: 'left',
  }
  await prisma.bannerAd.update({
    where: { id: ad.id },
    data: { config: JSON.stringify(config) },
  })
  console.log('the cover banner is a gradient again, with the text it had')
}

// The pictures the check wrote are removed from the store. The timestamps come
// back in a readable form rather than as ISO, so they are compared as dates.
const found = await list({
  prefix: 'uploads/',
  limit: 200,
  token: process.env.BLOB_READ_WRITE_TOKEN,
})
const since = new Date(Date.now() - 60 * 60 * 1000)
const mine = found.blobs.filter((blob) => new Date(blob.uploadedAt) > since)
for (const blob of mine) {
  await del(blob.pathname, { token: process.env.BLOB_READ_WRITE_TOKEN })
}
console.log(
  `removed ${mine.length} picture(s) written in the last hour; ${found.blobs.length - mine.length} left`
)

await prisma.$disconnect()
