import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { sharedConfig } from '../vite.shared'

/**
 * The web build: the same single-page app the Android WebView runs, served
 * from Cloudflare's static assets.
 *
 * It is one bundle rather than a server-rendered site, because the app was
 * always a browser application: every page reads its data from the API at
 * runtime, and the router lives in the browser. The Workers runtime serves
 * the files and answers deep links with the app itself, so `/events/key/abc`
 * and `/admin` work the moment they are opened.
 */
const webDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  ...sharedConfig,
  define: {
    // The web app and the API are served from the same origin by the same
    // Worker, so the app calls it with a relative path. That keeps the
    // request same-origin, which means no CORS preflight on every call.
    'import.meta.env.VITE_API_BASE': JSON.stringify('/api'),
  },
  build: {
    outDir: resolve(webDir, 'dist'),
    emptyOutDir: true,
  },
})
