import { devicesAPI } from './api'

/**
 * The web side of the Android app's push notifications.
 *
 * The plugins are imported lazily and every entry point checks that the page is
 * running inside the native shell, so the browser build behaves exactly as it
 * did: the imports never load a native module and no permission is ever asked
 * for online.
 */

/** The event the notification bell listens on to reload its list. */
export const NOTIFICATIONS_REFRESH_EVENT = 'event-invites:notifications-refresh'

/** Where the FCM token is remembered between launches and sign-ins. */
export const PUSH_TOKEN_KEY = 'event-invites:push-token'

/** The Android channel the app and the server both deliver on. */
export const PUSH_CHANNEL_ID = 'event_invites'

/** True only inside the Capacitor WebView, never in a browser. */
export async function isNativeApp(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** The platform name Capacitor reports: android, ios or web. */
export async function currentPlatform(): Promise<string> {
  try {
    const { Capacitor } = await import('@capacitor/core')
    return Capacitor.getPlatform()
  } catch {
    return 'web'
  }
}

/** The installed build's name and number, for the Profile screen and devices. */
export interface AppInfo {
  version: string
  build: string
}

/**
 * Reads the version Android installed. Outside the native shell there is no
 * build to report, so the web app's own package version is used instead and
 * nothing about the browser is sent to the server.
 */
export async function getAppInfo(): Promise<AppInfo | null> {
  if (!(await isNativeApp())) return null
  try {
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    return { version: info.version, build: info.build }
  } catch {
    return null
  }
}

export function getStoredPushToken(): string | null {
  try {
    return window.localStorage.getItem(PUSH_TOKEN_KEY)
  } catch {
    return null
  }
}

export function storePushToken(token: string): void {
  try {
    window.localStorage.setItem(PUSH_TOKEN_KEY, token)
  } catch {
    // A blocked storage API only means the token is re-issued next launch.
  }
}

export function clearStoredPushToken(): void {
  try {
    window.localStorage.removeItem(PUSH_TOKEN_KEY)
  } catch {
    // Nothing to do.
  }
}

/**
 * Stops notifications for this device before the session ends. Called from
 * `logout` while the access token still answers, so the next account on the
 * phone does not inherit the previous one's notifications.
 */
export async function unregisterPushDevice(): Promise<void> {
  const token = getStoredPushToken()
  if (token) {
    try {
      await devicesAPI.unregister(token)
    } catch {
      // Offline sign-out still clears the token locally.
    }
  }
  clearStoredPushToken()
  if (!(await isNativeApp())) return
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.unregister()
  } catch {
    // Nothing registered: nothing to undo.
  }
}

/** Tells the bell that the list changed, without losing the current panel. */
export function notifyNotificationsChanged(): void {
  try {
    window.dispatchEvent(new Event(NOTIFICATIONS_REFRESH_EVENT))
  } catch {
    // Server rendering has no window; nothing to notify.
  }
}
