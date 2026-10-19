import dotenv from 'dotenv'
// Local secrets live in the repository root .env.local, which is excluded from
// every deploy. Loading it explicitly means no .env file has to sit inside the
// deployed tree, where it would be uploaded along with the JWT secrets.
dotenv.config({ path: ['../.env.local', '.env.local'], quiet: true })
import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { errorHandler } from './middleware/errorHandler'
import { prisma } from './utils/prisma'
import { router as authRoutes } from './routes/auth'
import { router as eventRoutes } from './routes/events'
import { router as userRoutes } from './routes/users'
import { router as adminRoutes } from './routes/admin'
import { router as commentRoutes } from './routes/comments'
import { router as chatRoutes } from './routes/chats'
import { router as eventTemplateRoutes } from './routes/eventTemplates'
import { router as captchaRoutes } from './routes/captcha'
import { router as tagsRoutes } from './routes/tags'
import { router as uploadRoutes } from './routes/upload'
import { router as feedbackRoutes } from './routes/feedback'
import { router as activityRoutes } from './routes/activity'
import { router as notificationRoutes } from './routes/notifications'
import { router as deviceRoutes } from './routes/devices'
import {
  publicRouter as bannerPublicRoutes,
  adminRouter as bannerAdminRoutes,
} from './routes/banners'
import { UPLOAD_ROUTE, ensureUploadDir, resolveUpload, checkStorage, usesLocalDisk } from './utils/storage'
import { allowedOrigins, isCrossSiteDeployment } from './utils/cookies'

/**
 * The Express application, with no `listen` call.
 *
 * Keeping it separate from the bootstrap means the same app can be served by
 * a long-running Node process (local development, a VM, Railway) and by a
 * serverless request handler on Vercel.
 */
export const app = express()

const isProduction = process.env.NODE_ENV === 'production'

// Local development writes uploads to disk. On a serverless host that
// directory is ephemeral, so nothing is written there and the dir is never
// created.
if (usesLocalDisk()) {
  ensureUploadDir()
}

app.set('trust proxy', 1)

/**
 * CORS is only needed once the frontend lives on a different origin, which is
 * the case for the two-project split.
 *
 * The allowed origins are listed explicitly in FRONTEND_URL. When it is unset
 * no CORS headers are emitted: reflecting whatever origin asks, together with
 * `credentials: true`, would let any site read authenticated responses.
 * Same-origin deployments need no CORS at all.
 */
const corsOrigins = allowedOrigins()
app.use(
  cors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  })
)
if (corsOrigins.length === 0) {
  console.warn(
    '[config] FRONTEND_URL is not set. CORS headers are disabled. Set it to the ' +
      "frontend's origin when the two are deployed separately.",
  )
}
app.use(express.json())
app.use(cookieParser())

/**
 * Serves uploaded images. The URLs stored in the database are always
 * `/uploads/<file>`, so this indirection keeps existing rows valid whether the
 * bytes live on disk or in object storage.
 */
app.get(`${UPLOAD_ROUTE}/:filename`, async (req, res) => {
  const filename = req.params.filename
  // Reject anything that could escape the storage prefix.
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    res.status(404).end()
    return
  }
  try {
    const upload = await resolveUpload(filename)
    if (!upload) {
      res.status(404).json({ error: 'Image not found' })
      return
    }
    res.setHeader('Content-Type', upload.contentType)
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable')
    // A public store serves the browser itself; the redirect keeps the
    // transfer on the CDN instead of through this app.
    if (upload.redirectTo) {
      res.redirect(upload.redirectTo)
      return
    }
    if (upload.size) res.setHeader('Content-Length', String(upload.size))
    // Sent as one buffer rather than piped: the request reaches this
    // handler through the API catch-all, which gathers the response into a
    // buffer of its own, so a stream would only add a second hop.
    res.end(upload.body)
  } catch (err) {
    console.error('Failed to serve upload', err)
    res.status(500).json({ error: 'Failed to read image' })
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/events', eventRoutes)
app.use('/api/users', userRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/comments', commentRoutes)
app.use('/api/chats', chatRoutes)
app.use('/api/event-templates', eventTemplateRoutes)
app.use('/api/captcha', captchaRoutes)
app.use('/api/admin/banners', bannerAdminRoutes)
app.use('/api/admin/activity', activityRoutes)
app.use('/api/tags', tagsRoutes)
app.use('/api/upload', uploadRoutes)
app.use('/api/feedback', feedbackRoutes)
app.use('/api/banners', bannerPublicRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/devices', deviceRoutes)

/**
 * How long one dependency may take before the health check gives up on it.
 * A check that blocks for longer than this would be slow to answer on the
 * very connections it exists to report on, so a hung dependency reads as
 * "down" rather than stalling the probe.
 */
const PROBE_TIMEOUT_MS = 4000

/**
 * How long a fresh verdict is served from memory. The controller polls
 * often and may have several tabs open, so coalescing keeps one database
 * round trip per interval per process rather than one per request.
 */
const VERDICT_TTL_MS = 5000

/** The layers' last known state, and when it was settled. */
let healthVerdict: { database: 'ok' | 'down'; storage: 'ok' | 'down'; at: number } | null = null
/** The probe currently in flight, so concurrent callers share it. */
let healthProbeInFlight: Promise<{ database: 'ok' | 'down'; storage: 'ok' | 'down' }> | null = null

/**
 * Races a probe against a deadline, answering null on either outcome. A
 * rejecting probe matters as much as a hanging one — a database that
 * refuses the connection is the case this check exists to report — so the
 * rejection is turned into the same "down" answer, and the deadline's timer
 * is cleared whichever way the race settles rather than left pending.
 */
function withDeadline<T>(probe: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS)
  })
  return Promise.race([probe.catch(() => null), deadline]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
}

/** One pass over the layers, shared by everyone asking within the TTL. */
async function probeLayers(): Promise<{ database: 'ok' | 'down'; storage: 'ok' | 'down' }> {
  const database = (await withDeadline(prisma.$queryRaw`SELECT 1`)) ? 'ok' : 'down'
  const storage = (await withDeadline(checkStorage())) ? 'ok' : 'down'
  const verdict = { database, storage } as const
  healthVerdict = { ...verdict, at: Date.now() }
  return verdict
}

/**
 * The connection check the app's connectivity controller polls. Each layer
 * is probed separately so the controller can say which one is unavailable:
 * the database with a round trip, the upload store with a reachability
 * check. A 503 with this body means "reachable, but a layer is down" —
 * the distinction the controller draws between no connection and a broken
 * dependency.
 */
app.get('/api/health', async (req, res) => {
  // A verdict younger than the TTL is served as it stands; otherwise one
  // probe runs and every caller arriving meanwhile waits on it, so a burst
  // of polls — or several tabs — costs one round trip, not one each.
  const fresh = healthVerdict && Date.now() - healthVerdict.at < VERDICT_TTL_MS
  if (!fresh) {
    if (!healthProbeInFlight) {
      healthProbeInFlight = probeLayers().finally(() => {
        healthProbeInFlight = null
      })
    }
    await healthProbeInFlight
  }

  const { database, storage } = healthVerdict!
  const status = database === 'ok' && storage === 'ok' ? 'ok' : 'degraded'
  res.status(status === 'ok' ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    runtime: isProduction ? 'serverless' : 'node',
    storage: process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'disk',
    /** Whether each layer answered, for the connectivity controller. */
    database,
    storageReady: storage,
    corsOrigins,
    crossSiteCookies: isCrossSiteDeployment(),
  })
})

app.use(errorHandler)

export default app
