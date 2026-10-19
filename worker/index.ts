import { handleAsNodeRequest } from 'cloudflare:node'
import app from '../backend/src/app'
import { createPrismaClient, runWithPrisma } from '../backend/src/utils/prisma'

/**
 * The Cloudflare Workers entry point.
 *
 * The whole API is the same Express application the Node and Vercel
 * deployments use, running behind Cloudflare's `node:http` bridge rather than
 * a real socket. The port is only a routing key: it tells the runtime which
 * of the Worker's HTTP servers should take the request.
 */
const PORT = 4000

app.listen(PORT)

/**
 * The bindings the Worker needs.
 *
 * `HYPERDRIVE` is Cloudflare's pooled connection to the database. It is
 * preferred over a plain connection string because it keeps a warm pool next
 * to the database, so a request does not pay for a fresh TCP and TLS
 * handshake every time.
 *
 * `DATABASE_URL` is the fallback for a local `wrangler dev` run and for the
 * case where Hyperdrive has not been created yet.
 */
export interface Env {
  HYPERDRIVE?: { connectionString: string }
  DATABASE_URL?: string
  JWT_SECRET: string
  REFRESH_SECRET: string
  FRONTEND_URL?: string
  CROSS_SITE_AUTH?: string
  TURNSTILE_SECRET_KEY?: string
  CAPTCHA_SECRET?: string
  NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string
  FCM_SERVICE_ACCOUNT_JSON?: string
  FCM_PROJECT_ID?: string
  AWS_ENDPOINT_URL_S3?: string
  AWS_ACCESS_KEY_ID?: string
  AWS_SECRET_ACCESS_KEY?: string
  AWS_REGION?: string
  NEON_STORAGE_BUCKET?: string
  NEON_STORAGE_ACCESS?: string
  STORAGE_BACKEND?: string
}

function connectionStringFor(env: Env): string {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL
  if (!connectionString) {
    throw new Error('The Worker has no database connection: set the Hyperdrive binding or DATABASE_URL')
  }
  return connectionString
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // A client per request: the Workers runtime does not let a socket opened
    // during one request be used by another, so a client held at module level
    // answers the first request and hangs the second.
    const client = createPrismaClient(connectionStringFor(env))

    const response = await runWithPrisma(client, () =>
      handleAsNodeRequest(PORT, request)
    )

    // The connection is released after the response is on its way.
    ctx.waitUntil(client.$disconnect())

    return response
  },
}
