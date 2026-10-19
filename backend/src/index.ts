import 'dotenv/config'
import app from './app'

/**
 * Long-running bootstrap, used by `npm run dev` and by hosts that run a
 * persistent Node process (Railway, Render, a VM). Vercel does not call this:
 * it imports `app` from the serverless entry instead.
 */
const PORT = Number(process.env.PORT) || 4000

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(
    `Storage: ${process.env.BLOB_READ_WRITE_TOKEN ? 'object storage' : 'local disk (development)'}`
  )
})