import 'dotenv/config'
import app from './app'
import { storeName } from './utils/storage'

/**
 * Long-running bootstrap, used by `npm run dev` and by hosts that run a
 * persistent Node process (Railway, Render, a VM). The Cloudflare Worker and
 * the Vercel serverless entry do not call this: they import `app` and serve
 * it themselves.
 */
const PORT = Number(process.env.PORT) || 4000

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(
    `Storage: ${storeName() === 'object' ? 'object storage' : 'local disk (development)'}`
  )
})