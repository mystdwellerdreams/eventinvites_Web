import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import type { UserConfig } from 'vite'

/**
 * The settings every bundle of the app shares.
 *
 * The app is built twice from one `src/`: for the Android WebView and for
 * the browser. The aliases are the whole trick. Components import
 * `next/link` and `next/navigation`; in a Vite build both resolve to one
 * React Router facade, so no source file has to know which bundle it is in.
 */
const repoRoot = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(repoRoot, 'src')
const navigationFacade = resolve(srcDir, 'utils/navigation.router.tsx')

export const sharedConfig: UserConfig = {
  root: resolve(repoRoot, 'mobile/app'),
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
}
