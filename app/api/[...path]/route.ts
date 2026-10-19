import { Readable, Writable } from 'node:stream'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import expressApp from '../../../backend/src/app'

/**
 * Serves the whole API by delegating to the existing Express application.
 *
 * Next's App Router hands route handlers a Web `Request` and expects a Web
 * `Response`, while Express is written against Node's `IncomingMessage` and
 * `ServerResponse`. Rather than rewrite every route, middleware and policy in
 * the project, the request is adapted across and the response collected back.
 *
 * The alternative, porting ~15 routers to native route handlers, would put
 * working, tested auth and visibility logic at risk for no gain.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_BODY_METHODS = new Set(['GET', 'HEAD'])

function collectHeaders(source: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  source.forEach((value, key) => {
    out[key.toLowerCase()] = value
  })
  return out
}

// Statuses that must not carry a body. `new Response(body, { status })` throws
// for these, and Express does produce 304 when an ETag matches.
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304])

export async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()

  // Buffer the body so Express's parsers and multer can read it as a stream.
  const body =
    !NO_BODY_METHODS.has(method) && request.body
      ? Buffer.from(await request.arrayBuffer())
      : null

  const req = Readable.from(body ? [body] : []) as unknown as ExpressRequest
  req.method = method
  req.url = `${url.pathname}${url.search}`
  req.headers = collectHeaders(request.headers)
  req.query = Object.fromEntries(url.searchParams.entries())
  req.params = {}
  req.originalUrl = req.url
  // Express reads req.socket.encrypted to decide cookie security; only that
  // flag matters here, so a partial stub is enough.
  req.socket = { encrypted: url.protocol === 'https:' } as unknown as ExpressRequest['socket']
  ;(req as { connection?: unknown }).connection = req.socket
  ;(req as { rawBody?: unknown }).rawBody = body

  const chunks: Buffer[] = []
  const outHeaders = new Headers()

  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string))
      callback()
    },
  }) as unknown as ExpressResponse

  // statusCode is the single source of truth. Express's own helpers call
  // res.status(), but its 404 finalhandler assigns res.statusCode directly, so a
  // separate mirror variable would miss those and report every unknown route as
  // 200.
  let statusCode = 200
  Object.defineProperty(res, 'statusCode', {
    get: () => statusCode,
    set: (value: number) => {
      statusCode = value
    },
    enumerable: true,
    configurable: true,
  })

  const setHeader = (name: string, value: string | number | readonly string[]) => {
    if (Array.isArray(value)) {
      for (const item of value) outHeaders.append(name, String(item))
    } else {
      outHeaders.set(name, String(value))
    }
    return res
  }

  res.status = ((code: number) => {
    res.statusCode = code
    return res
  }) as ExpressResponse['status']
  res.setHeader = setHeader as ExpressResponse['setHeader']
  res.getHeader = ((name: string) => outHeaders.get(name)) as ExpressResponse['getHeader']
  res.getHeaderNames = (() => [...outHeaders.keys()]) as ExpressResponse['getHeaderNames']
  res.hasHeader = ((name: string) => outHeaders.has(name)) as ExpressResponse['hasHeader']
  res.removeHeader = ((name: string) => {
    outHeaders.delete(name)
    return res
  }) as ExpressResponse['removeHeader']
  res.writeHead = ((code: number, headers?: Record<string, string | string[]>) => {
    res.statusCode = code
    if (headers) {
      for (const [name, value] of Object.entries(headers)) setHeader(name, value)
    }
    return res
  }) as ExpressResponse['writeHead']
  res.flushHeaders = (() => res) as ExpressResponse['flushHeaders']

  let finished: (() => void) | undefined
  const done = new Promise<void>((resolve) => {
    finished = resolve
  })

  // Express finishes by calling res.end; resolve once the stream closes.
  res.on('finish', () => finished?.())

  const originalEnd = res.end.bind(res)
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      )
    }
    const result = originalEnd(chunk as never, ...(rest as []))
    finished?.()
    return result
  }) as ExpressResponse['end']

  // A handler that throws must still settle the promise.
  try {
    const result = expressApp(req, res)
    if (result && typeof (result as Promise<unknown>).catch === 'function') {
      await (result as Promise<unknown>).catch(() => undefined)
    }
  } catch {
    // fall through; the error middleware has already responded
  }
  await done

  const finalStatus = res.statusCode

  if (NULL_BODY_STATUS.has(finalStatus)) {
    // Headers describing a body that is not being sent would be misleading.
    outHeaders.delete('content-length')
    outHeaders.delete('content-type')
    return new Response(null, { status: finalStatus, headers: outHeaders })
  }

  return new Response(Buffer.concat(chunks), {
    status: finalStatus,
    headers: outHeaders,
  })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
export const HEAD = handler