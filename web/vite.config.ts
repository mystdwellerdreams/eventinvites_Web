import { copyFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { repoRoot, sharedConfig } from '../vite.shared'

/**
 * The web build: the same single-page app the Android WebView runs, served
 * from GitHub Pages.
 *
 * It is one bundle rather than a server-rendered site, because the app was
 * always a browser application: every page reads its data from the API at
 * runtime, and the router lives in the browser.
 *
 * Two things differ from the other builds, and both come from the app and the
 * API living on different hosts:
 *
 * - The API is named in full, because a relative path would resolve against
 *   the Pages site rather than the API.
 * - A 404.html is written alongside index.html, because GitHub Pages has no
 *   single-page fallback and would otherwise answer a deep link such as
 *   /events/key/abc with its own error page.
 */
const webDir = dirname(fileURLToPath(import.meta.url))

/**
 * GitHub Pages answers any path it cannot find with the 404.html from the
 * site root. Copying the app there means the browser stays on the URL that
 * was asked for, and the router — which reads the path from the address —
 * routes it exactly as it routes any other path.
 *
 * The copy is made once the bundle is written, because Vite emits the HTML
 * after the point where a plugin could add to it.
 */
function pagesNotFound(): Plugin {
  return {
    name: 'github-pages-not-found',
    apply: 'build',
    closeBundle() {
      const dist = resolve(webDir, 'dist')
      const index = resolve(dist, 'index.html')
      if (!existsSync(index)) return
      copyFileSync(index, resolve(dist, '404.html'))
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, repoRoot, 'VITE_')

  // The API's origin. It has to be absolute, because the app and the API are
  // served from different hosts; a relative path would ask Pages for it.
  const apiBase = (env.VITE_API_BASE || '/api').trim()

  // Where the site is published. A user site is at the root; a project site
  // lives under the repository's name, and the router has to be told.
  const base = (process.env.PAGES_BASE || '/').trim()
  const basename = base === '/' || base === '' ? '' : base.replace(/\/+$/, '')

  return {
    ...sharedConfig,
    base,
    plugins: [...(sharedConfig.plugins ?? []), pagesNotFound()],
    define: {
      'import.meta.env.VITE_API_BASE': JSON.stringify(apiBase),
      __ROUTER_BASENAME__: JSON.stringify(basename),
    },
    build: {
      outDir: resolve(webDir, 'dist'),
      emptyOutDir: true,
    },
  }
})
