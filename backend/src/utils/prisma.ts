import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'

/**
 * Prisma's client is per request on the Workers runtime.
 *
 * A Node process keeps one client for its whole life, but a Worker must not:
 * the runtime does not let a socket opened during one request be used by
 * another, so a client held at module level answers the first request and
 * hangs the second. The Worker therefore builds a client per request and puts
 * it in scope, and this module hands that one out.
 *
 * The scope is an AsyncLocalStorage rather than a plain variable so that
 * concurrent requests cannot see each other's client. Every module keeps
 * importing `prisma` and calling it the same way.
 */
const requestScope = new AsyncLocalStorage<PrismaClient>()

/**
 * The timeouts a cold database needs.
 *
 * A managed database scales to zero, and the first connection has to wake it.
 * Prisma's default of five seconds is often not enough, so the timeouts are
 * added when the connection string does not carry them. Without them the
 * first request after an idle period fails while the ones after it succeed.
 */
function withTimeouts(connectionString: string): string {
  const [base, query = ''] = connectionString.split('?')
  const params = new URLSearchParams(query)
  if (!params.has('connect_timeout')) params.set('connect_timeout', '15')
  if (!params.has('pool_timeout')) params.set('pool_timeout', '10')
  return `${base}?${params.toString()}`
}

/** Builds a client for one request, or for the life of a Node process. */
export function createPrismaClient(connectionString: string): PrismaClient {
  return new PrismaClient({
    // The `pg` driver makes the connection, so the same client runs on Node
    // and on the Workers runtime, where the engine's own driver cannot.
    adapter: new PrismaPg({ connectionString: withTimeouts(connectionString) }),
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })
}

/**
 * Runs `fn` with `client` in scope.
 *
 * The client is not closed here: on the Workers runtime the caller hands the
 * close over to `ctx.waitUntil`, so the response is not held up by it.
 */
export function runWithPrisma<T>(client: PrismaClient, fn: () => Promise<T>): Promise<T> {
  return requestScope.run(client, fn)
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

/**
 * The client used when no request scope is active, which is the case in a
 * long-running Node process: local development, and the Vercel deployment.
 * It is created once and kept for the life of the process, the way a Node
 * server has always used it.
 */
let processClient: PrismaClient | null = null

function processClientOrCreate(): PrismaClient {
  if (!processClient) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set, so no database connection can be made')
    }
    processClient = createPrismaClient(connectionString)
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = processClient
  }
  return processClient
}

function currentClient(): PrismaClient {
  return requestScope.getStore() ?? processClientOrCreate()
}

/**
 * The client every module uses.
 *
 * It forwards to the request's own client when there is one, and to the
 * process-wide client otherwise, so the 257 call sites in this backend keep
 * working unchanged.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = currentClient()
    const value = client[property as keyof PrismaClient]
    // Model delegates are objects, but the `$`-prefixed methods are functions
    // that need the client as their receiver.
    return typeof value === 'function' ? value.bind(client) : value
  },
})
