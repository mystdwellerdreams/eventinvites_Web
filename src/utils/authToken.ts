/**
 * The app's in-memory and Keystore-backed token management.
 *
 * Bearer tokens are the APK's auth mechanism (D9). The access token lives in
 * memory for the lifetime of the process; the refresh token is persisted in the
 * Android Keystore via `capacitor-secure-storage-plugin`, so a killed or
 * restarted process can still trade it for a fresh pair.
 *
 * On the web every persistence call is a no-op: cookies remain the only
 * mechanism, and the in-memory access token is never read (the request
 * interceptor sees null and adds no header). The two builds share one `src/`
 * without branching.
 */
import { isNativeApp } from './nativePush'

/** In-memory access token: short-lived, never persisted. */
let accessToken: string | null = null

/** SecureStorage keys. */
const ACCESS_KEY = 'access'
const REFRESH_KEY = 'refresh'

/**
 * Reads a single value from the Keystore. On the web the guard short-circuits
 * before the plugin is ever imported, so no native code is exercised.
 */
async function getSecure(key: string): Promise<string | null> {
  if (!(await isNativeApp())) return null
  try {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin')
    const result = await SecureStoragePlugin.get({ key })
    return result?.value ?? null
  } catch {
    return null
  }
}

/** Writes a value to the Keystore. */
async function setSecure(key: string, value: string): Promise<void> {
  if (!(await isNativeApp())) return
  try {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin')
    await SecureStoragePlugin.set({ key, value })
  } catch {
    // Storage failed: the token stays in memory only, which still works until
    // the process is killed. The next launch will fall back to sign-in.
  }
}

/** Removes a value from the Keystore. */
async function removeSecure(key: string): Promise<void> {
  if (!(await isNativeApp())) return
  try {
    const { SecureStoragePlugin } = await import('capacitor-secure-storage-plugin')
    await SecureStoragePlugin.remove({ key })
  } catch {
    // Nothing to remove or already gone.
  }
}

/** The access token currently in memory, or null. */
export function getAccessToken(): string | null {
  return accessToken
}

/** Sets the access token in memory only. */
export function setAccessToken(token: string): void {
  accessToken = token
}

/** Clears the access token from memory. */
export function clearAccessToken(): void {
  accessToken = null
}

/**
 * Loads the refresh token from the Keystore. Returns null on the web, where
 * the HttpOnly cookie is the only refresh mechanism.
 */
export async function loadRefreshToken(): Promise<string | null> {
  return getSecure(REFRESH_KEY)
}

/** Persists the refresh token to the Keystore. No-op on the web. */
export async function storeRefreshToken(token: string): Promise<void> {
  await setSecure(REFRESH_KEY, token)
}

/** Removes the refresh token from the Keystore. */
export async function clearRefreshToken(): Promise<void> {
  await removeSecure(REFRESH_KEY)
}

/**
 * Stores a freshly issued token pair: the access token in memory and the
 * refresh token in the Keystore. On the web the access token is still set in
 * memory (so a subsequent in-memory read is consistent) but never persisted;
 * nothing in the web path reads it.
 */
export async function storeSession(access: string, refresh: string): Promise<void> {
  accessToken = access
  await setSecure(REFRESH_KEY, refresh)
}

/**
 * Clears everything: the in-memory access token and the persisted refresh
 * token. Safe to call on the web (all persistence is no-op).
 */
export async function clearSession(): Promise<void> {
  accessToken = null
  await removeSecure(REFRESH_KEY)
}

/** Re-exports are used by authAPI to decide whether `client: 'app'` applies. */
export { isNativeApp, ACCESS_KEY }
