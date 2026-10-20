import dotenv from 'dotenv'
import { list, del } from '@vercel/blob'

dotenv.config({ path: ['../.env.local', '.env.local'], quiet: true })

const token = process.env.BLOB_READ_WRITE_TOKEN
const found = await list({ prefix: 'uploads/', limit: 100, token })
console.log('objects in the store:', found.blobs.length)

// The files a check leaves behind, and only those.
const mine = ['2f7e22d2-8063-4034-8ebf-792f41af5b72.png', '304f2028-0f60-417c-8070-db6a38ac6200.png', '85316f38-ccf1-4087-9d6f-83aafd6c89ad.png']
for (const blob of found.blobs) {
  if (mine.includes(blob.pathname.split('/').pop() ?? '')) {
    await del(blob.pathname, { token })
    console.log('  removed', blob.pathname)
  } else {
    console.log('  kept   ', blob.pathname, blob.uploadedAt)
  }
}

const after = await list({ prefix: 'uploads/', limit: 100, token })
console.log('objects left:', after.blobs.length)
