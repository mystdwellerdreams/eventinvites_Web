import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The bundled app build: the same `src/` the browser gets from Next, packaged
 * for the Capacitor WebView.
 *
 * The aliases are the whole trick. Components import `next/link` and
 * `next/navigation`; here both resolve to one React Router facade, so no
 * source file needs to know which build it is in. The Next build resolves the
 * real modules and never sees the facade.
 *
 * `www/` is generated and gitignored; `cap sync android` copies it into the
 * Android project.
 */

const mobileDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(mobileDir, '..')
const srcDir = resolve(repoRoot, 'src')
const navigationFacade = resolve(srcDir, 'utils/navigation.router.tsx')

export default defineConfig({
  root: resolve(mobileDir, 'app'),
  // The app's own assets (the logo) live in the repository's public/.
  publicDir: resolve(repoRoot, 'public'),
  // Read VITE_* from the repository's .env files, beside the Next variables.
  envDir: repoRoot,
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: srcDir },
      { find: 'next/link', replacement: navigationFacade },
      { find: 'next/navigation', replacement: navigationFacade },
    ],
  },
  build: {
    outDir: resolve(mobileDir, 'www'),
    emptyOutDir: true,
  },
})
