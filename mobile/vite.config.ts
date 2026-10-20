import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import { sharedConfig } from '../vite.shared'

/**
 * The bundled app build: the same `src/` the browser gets, packaged for the
 * Capacitor WebView.
 *
 * `www/` is generated and gitignored; `cap sync android` copies it into the
 * Android project.
 */
const mobileDir = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  ...sharedConfig,
  define: {
    // The WebView serves the app from the root of its own origin, so the
    // router needs no basename.
    __ROUTER_BASENAME__: JSON.stringify(''),
  },
  build: {
    outDir: resolve(mobileDir, 'www'),
    emptyOutDir: true,
  },
})
