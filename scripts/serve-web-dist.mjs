import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

/**
 * Serves the built web app the way GitHub Pages does: a file if there is
 * one, and otherwise the 404.html from the site root, with a 404 status.
 *
 * It is here to prove that a deep link reaches the app rather than an error
 * page, which is the one thing the Pages deployment has to get right.
 */
const DIST = resolve('web/dist')
// The path the site is published under, for a project site that lives in a
// subdirectory. A user site is at the root.
const BASE = (process.argv[2] || '/').replace(/\/+$/, '')
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
  const relative = BASE && path.startsWith(BASE) ? path.slice(BASE.length) : path
  const candidate = join(DIST, normalize(relative).replace(/^([/\\])+/, ''))

  const send = async (file, status) => {
    const body = await readFile(file)
    res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    res.end(body)
  }

  try {
    const info = await stat(candidate)
    if (info.isFile()) return await send(candidate, 200)
    // A directory is served with its index.html, as a static host does.
    if (info.isDirectory()) return await send(join(candidate, 'index.html'), 200)
  } catch {
    // Not a file; fall through to the not-found page.
  }

  // What GitHub Pages does for a path it cannot find.
  try {
    await send(join(DIST, '404.html'), 404)
  } catch {
    res.writeHead(404).end('not found')
  }
})

server.listen(4173, () => console.log(`serving web/dist on http://127.0.0.1:4173${BASE || '/'}`))
