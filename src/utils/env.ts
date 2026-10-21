/**
 * One place that answers "what is the API base, and where is the captcha key".
 *
 * The same `src/` is built twice: Next.js for the browser and Vite for the APK.
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time; Vite inlines
 * `import.meta.env.VITE_*`. Reading both here means no other module has to know
 * which build it is running under, and the `typeof process` guard keeps the
 * Vite bundle from throwing on an undefined `process`.
 */

export type EnvName = 'API_BASE' | 'TURNSTILE_SITE_KEY'

export function env(name: EnvName): string {
  // Next inlines `process.env.NEXT_PUBLIC_*` when it sees the name written
  // out, so the two are spelled out here rather than looked up by a computed
  // name. A computed lookup is not inlined, and in the browser there is no
  // `process` to read it from — the value would simply go missing, and with
  // it the captcha's site key.
  const next =
    typeof process === 'undefined'
      ? undefined
      : name === 'TURNSTILE_SITE_KEY'
        ? process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
        : process.env.NEXT_PUBLIC_API_BASE
  if (next) return next

  const vite = (import.meta as ImportMeta & { env?: Record<string, string> }).env
  return vite?.[`VITE_${name}`] ?? ''
}

/**
 * The API root. `/api` is same-origin, which is what the web build wants: Next
 * serves the pages and the catch-all together. The app build sets
 * `VITE_API_BASE` to the absolute URL of the deployment.
 */
export const API_BASE = env('API_BASE') || '/api'
