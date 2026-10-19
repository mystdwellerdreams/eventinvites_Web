import type { CapacitorConfig } from '@capacitor/cli'

/**
 * The Android shell for the web application.
 *
 * The Next.js app is served from the same origin as its API, and its auth
 * cookies are first-party. Reproducing that as a bundled static build would
 * mean rewriting every dynamic route (`/events/<id>`, `/events/key/<key>`), so
 * the shell loads the deployed site directly in a WebView instead. Everything
 * — pages, API and cookies — then behaves exactly as it does in a browser.
 *
 * Point it at the deployment that should be shipped:
 *
 *   CAPACITOR_SERVER_URL=https://your-app.vercel.app npx cap sync android
 *
 * With no URL set it falls back to the Android emulator's alias for the host
 * machine, which is what `npm run dev` (Next on :3000) answers on.
 */
const serverUrl = process.env.CAPACITOR_SERVER_URL || 'http://10.0.2.2:3000'
const isHttps = serverUrl.startsWith('https://')

const config: CapacitorConfig = {
  appId: 'club.kolymafia.eventinvites',
  appName: 'Event Invites',
  // Only used if `server.url` is removed: a plain loading screen.
  webDir: 'mobile/www',
  server: {
    url: serverUrl,
    // The emulator fallback is plain HTTP; production deployments are HTTPS.
    cleartext: !isHttps,
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
