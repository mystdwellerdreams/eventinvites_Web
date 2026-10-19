'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '../context/AuthContext'
import { devicesAPI, notificationsAPI } from '../utils/api'
import {
  PUSH_CHANNEL_ID,
  currentPlatform,
  getAppInfo,
  getStoredPushToken,
  isNativeApp,
  notifyNotificationsChanged,
  storePushToken,
} from '../utils/nativePush'

/** FCM data arrives as strings; these are the keys the server sends. */
interface PushData {
  kind?: string
  type?: string
  route?: string
  notificationId?: string
  broadcastId?: string
  [key: string]: string | undefined
}

/**
 * Inside the Android app this component connects Firebase Cloud Messaging to
 * the application's own notification system:
 *
 * - the device token is registered against the signed-in account, so a push is
 *   sent to that account's devices only;
 * - a push that arrives while the app is open becomes a system notification and
 *   reloads the bell;
 * - tapping a push opens the screen the notification belongs to and marks it
 *   read, exactly as clicking the row in the bell would.
 *
 * In a browser none of this runs. It is mounted under the auth provider so the
 * token follows the session, and the listeners are attached once.
 */
export default function NativeBridge() {
  const { user } = useAuth()
  const router = useRouter()
  const userId = user?.id
  // The nav function changes with the route; a ref keeps the one-time
  // listeners reading the latest one.
  const routerRef = useRef(router)
  routerRef.current = router

  // Attach the plugin listeners once, and create the Android channel they use.
  useEffect(() => {
    let disposed = false
    let teardown: (() => void) | undefined

    const attach = async () => {
      if (!(await isNativeApp()) || disposed) return

      const [{ PushNotifications }, { LocalNotifications }, { App }] = await Promise.all([
        import('@capacitor/push-notifications'),
        import('@capacitor/local-notifications'),
        import('@capacitor/app'),
      ])
      if (disposed) return

      // The server names this channel in every message; without it FCM falls
      // back to a channel Android may not have created.
      await LocalNotifications.createChannel({
        id: PUSH_CHANNEL_ID,
        name: 'Notifications',
        description: 'Events, messages and announcements',
        importance: 5,
        visibility: 1,
        vibration: true,
      }).catch(() => undefined)
      if (disposed) return

      /** Opens what a tapped notification points at, and marks it read. */
      const open = (raw?: Record<string, string | undefined>) => {
        const data = (raw ?? {}) as PushData

        // The row exists in the app's own notification system, so opening the
        // push is the same act as opening it in the bell.
        if (data.kind === 'individual' && data.notificationId) {
          notificationsAPI.read(data.notificationId).catch(() => undefined)
        } else if (data.kind === 'broadcast' && data.broadcastId) {
          notificationsAPI.readBroadcast(data.broadcastId).catch(() => undefined)
        }
        notifyNotificationsChanged()

        const route = typeof data.route === 'string' ? data.route : ''
        if (route) routerRef.current.push(route)
      }

      const subscriptions = await Promise.all([
        PushNotifications.addListener('registration', async (token) => {
          storePushToken(token.value)
          try {
            const info = await getAppInfo()
            await devicesAPI.register({
              token: token.value,
              platform: await currentPlatform(),
              ...(info ? { appVersion: info.version } : {}),
            })
          } catch {
            // Not signed in yet, or offline: the token is retried on sign-in.
          }
        }),

        PushNotifications.addListener('registrationError', (error) => {
          console.warn('[push] registration failed', error)
        }),

        // Received while the app is open: Android shows nothing by itself, so
        // it is posted as a local notification and the bell is refreshed.
        PushNotifications.addListener('pushNotificationReceived', async (notification) => {
          notifyNotificationsChanged()
          const data = (notification.data ?? {}) as PushData
          await LocalNotifications.schedule({
            notifications: [
              {
                id: notificationId(data, notification.title),
                title: notification.title ?? 'Event Invites',
                body: notification.body ?? '',
                channelId: PUSH_CHANNEL_ID,
                extra: data,
              },
            ],
          }).catch(() => undefined)
        }),

        PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
          open(event.notification.data as PushData)
        }),

        LocalNotifications.addListener('localNotificationActionPerformed', (event) => {
          open(event.notification.extra as PushData)
        }),

        // The web app is a single busy route: back should walk the history the
        // WebView kept, and only leave the app once there is nowhere to go.
        App.addListener('backButton', ({ canGoBack }) => {
          if (canGoBack) window.history.back()
          else App.exitApp()
        }),

        // Coming back to the app is a good moment to pick up anything missed.
        App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) notifyNotificationsChanged()
        }),
      ])

      teardown = () => {
        for (const subscription of subscriptions) void subscription.remove()
      }
      // The component may have gone away while the listeners were attaching.
      if (disposed) teardown()
    }

    void attach()

    return () => {
      disposed = true
      teardown?.()
    }
  }, [])

  // A signed-in account registers its device; signing out is handled in the
  // auth context, which removes the device before the session ends.
  useEffect(() => {
    if (!userId) return
    let cancelled = false

    const register = async () => {
      if (!(await isNativeApp()) || cancelled) return
      const { PushNotifications } = await import('@capacitor/push-notifications')

      const current = await PushNotifications.checkPermissions().catch(() => null)
      const permission =
        current?.receive === 'granted'
          ? current
          : await PushNotifications.requestPermissions().catch(() => null)
      if (permission?.receive !== 'granted' || cancelled) return

      // register() re-emits the token through the listener above, which is what
      // stores it against this account. A token issued before this account
      // signed in is sent here instead.
      const stored = getStoredPushToken()
      if (stored) {
        try {
          const info = await getAppInfo()
          await devicesAPI.register({
            token: stored,
            platform: await currentPlatform(),
            ...(info ? { appVersion: info.version } : {}),
          })
        } catch {
          // Retried by the registration listener once FCM re-issues it.
        }
      }
      await PushNotifications.register().catch(() => undefined)
    }

    void register()
    return () => {
      cancelled = true
    }
  }, [userId])

  return null
}

/** A stable 32-bit id for a local notification, from its identity. */
function notificationId(data: PushData, title?: string): number {
  const key = data.notificationId || data.broadcastId || `${title ?? ''}:${Date.now()}`
  let hash = 0
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0
  }
  return Math.abs(hash) || 1
}
