import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Android shell for the web application.
 *
 * Two modes, selected by `CAPACITOR_DEV`:
 *
 * - Dev (`CAPACITOR_DEV=1`): the shell loads a live dev server — Vite on
 *   `http://10.0.2.2:5173` by default, or `CAPACITOR_SERVER_URL` when set — so
 *   changes to `src/` appear without a rebuild. Cleartext is allowed because a
 *   laptop URL is plain HTTP.
 *
 * - Release (no env var): `server.url` is absent, so the shell loads the
 *   pre-bundled Vite output from `mobile/www/`. `https://localhost` is the
 *   origin the WebView answers on, so auth and API requests are same-origin
 *   to the bundle and never touch the browser's cookie jar.
 *
 * A release build never inherits a laptop URL: the env var is the only
 * switch that writes `server.url` at all (D15).
 */
const devUrl =
  process.env.CAPACITOR_DEV === '1'
    ? process.env.CAPACITOR_SERVER_URL ?? 'http://10.0.2.2:5173'
    : undefined

const config: CapacitorConfig = {
  appId: 'club.kolymafia.eventinvites',
  appName: 'Event Invites',
  webDir: 'mobile/www',
  server: devUrl
    ? { url: devUrl, cleartext: true, androidScheme: 'https' }
    : { androidScheme: 'https' },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SystemBars: {
      // The app draws edge to edge, so the content has to make room for the
      // status bar itself. Capacitor publishes the measured insets as CSS
      // custom properties, which the layout uses.
      insetsHandling: 'css',
      // The shell already says `viewport-fit=cover` in its viewport tag.
      // Saying so here as well lets the insets be applied on the first pass,
      // before the page is painted, so the content does not jump.
      initialViewportFitValueHint: 'cover',
    },
  },
}

export default config
