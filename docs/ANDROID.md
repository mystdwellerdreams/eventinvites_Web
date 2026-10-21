# The Android app

The Android app is a [Capacitor](https://capacitorjs.com) shell around the same
`src/` the browser uses. The Next.js app keeps serving the web; the APK ships a
**Vite build** of that code, bundled into `mobile/www/` and served by the
WebView from `https://localhost`. Pages, the API and auth all travel over
`Authorization: Bearer` headers against the deployed API — no cookies, because
the WebView's `https://localhost` origin makes them third-party and the Android
WebView drops third-party cookies by default. On top of that shell layer,
**push notifications arrive through Firebase Cloud Messaging**, wired into the
app's own notification system rather than beside it.

```
┌─────────────────────────── APK ─────────────────────────────────┐
│  Capacitor 8 WebView          https://localhost                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Vite bundle of src/ (React Router, BrowserRouter)         │  │
│  │ src/utils/navigation.router.tsx ← alias of next/link      │  │
│  │     and next/navigation                                   │  │
│  │ Bearer access token in memory                            │  │
│  │ refresh token in Keystore (EncryptedSharedPreferences)     │  │
│  └───────────────────────────────────────────────────────────┘  │
│  NativeBridge: FCM token, channels, taps, badge                 │
│  androidScheme: https → API is same-origin to the bundle         │
└─────────────────────────┬──────────────────────────────────────┘
                          │ HTTPS, Authorization: Bearer
                          │ CORS allow-list includes https://localhost
┌─────────────────────────▼──────────────────────────────────────┐
│ Vercel: Next catch-all → Express → Prisma/Neon/Blob            │
└────────────────────────────────────────────────────────────────┘
```

The push layer is inert until a service account is configured. Without
`FCM_SERVICE_ACCOUNT_JSON` the API behaves exactly as it did before the app
existed.

## What is where

| Path | Role |
| ---- | ---- |
| `capacitor.config.ts` | App id, name, and `webDir: mobile/www`. `server.url` is set only when `CAPACITOR_DEV=1`; a release build loads the bundle with no server URL at all. |
| `mobile/vite.config.ts` | The app build: aliases `next/link` and `next/navigation` to `src/utils/navigation.router.tsx`, bundles `src/` into `mobile/www/`. |
| `mobile/app/` | Vite entry: `index.html`, `main.tsx` and `App.tsx` (the route table). `mobile/www/` is generated and gitignored. |
| `src/utils/navigation.router.tsx` | The React Router facade that stands in for `next/link` and `next/navigation` in the app build. No source file imports it directly. |
| `src/utils/authToken.ts` | In-memory access token and Keystore-backed refresh token. No-op on the web. |
| `src/utils/env.ts` | Reads `NEXT_PUBLIC_*` (Next) or `VITE_*` (Vite) so one import works in both builds. |
| `src/components/NativeBridge.tsx` | Registers the device, turns pushes into local notifications, routes taps. |
| `src/utils/nativePush.ts` | Small helpers: stored token, app-version read, sign-out removal, bell refresh event. |
| `backend/src/middleware/auth.ts` | Accepts `Authorization: Bearer` first, then the `accessToken` cookie. |
| `backend/src/routes/auth.ts` | Issues a `refreshToken` in the JSON body when `client === 'app'`; accepts it on refresh and logout. |
| `backend/src/routes/devices.ts` | `POST /devices`, `DELETE /devices`, `POST /devices/test`. |
| `backend/src/utils/push.ts` | FCM HTTP v1 delivery, access-token caching, stale-token cleanup. |
| `backend/src/utils/notifications.ts` | Sends the push right after each notification row is written. |
| `android/` | The generated Capacitor project: Gradle, manifest, resources, app icons. |
| `mobile/scripts/generate-assets.mjs` | Rebuilds the launcher icons and splash screens from `public/logo.png`. |
| `android/app/src/main/res/xml/network_security_config.xml` | HTTPS everywhere, cleartext only for the emulator host. |

## Prerequisites

- **Node 22** — the version the repository pins in `engines`.
- **JDK 21** — Capacitor 8 compiles against Java 21 (`android/app/capacitor.build.gradle`).
- **Android Studio** with the **Android SDK Platform 36** and matching build tools (the project targets SDK 36, minimum SDK 24).
- A **Firebase project** for `google-services.json` and the service-account key.

## 1. Firebase

1. In the [Firebase console](https://console.firebase.google.com) create a
   project (or reuse one).
2. **Add app → Android**, with the package name

   ```
   club.kolymafia.eventinvites
   ```

   It must match `appId` in `capacitor.config.ts` and `applicationId` in
   `android/app/build.gradle`.
3. Download `google-services.json` and put it at
   `android/app/google-services.json`. **Do not commit it.** Gradle applies the
   `com.google.gms.google-services` plugin only when the file is present, so the
   project still builds without it — push simply does nothing.
4. Under **Project settings → Service accounts**, click **Generate new private
   key**. You now have the JSON the API signs FCM requests with.

Set it on **the API's** environment (Vercel → your project → Settings →
Environment Variables, for Production *and* Preview), and in `.env.local` for
local development:

```bash
FCM_SERVICE_ACCOUNT_JSON='{"type":"service_account","project_id":"…", …}'
```

If pasting the whole JSON is awkward, base64-encode it first — both forms are
accepted:

```bash
base64 -w0 service-account.json          # macOS/Linux
[Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account.json"))  # PowerShell
```

`FCM_PROJECT_ID` may be set on its own to override the project named inside the
key.

## 2. Build the bundle

The APK contains no server URL to fall back on — it loads its own code from
`mobile/www/`. Build that bundle before every `cap sync`:

```bash
npm run app:build          # vite build → mobile/www/
```

The build needs `VITE_API_BASE` — the absolute API URL the app talks to, e.g.

```bash
VITE_API_BASE=https://your-app.vercel.app/api npm run app:build
```

Without it Vite inlines an empty string and `env.ts` falls back to `/api`, which
in the APK resolves to `https://localhost/api` — nothing is listening there
once a release build has no `server.url`, so sign-in would fail. CI enforces this
(see Phase 4).

For **live reload** during development, run Vite and let the shell load it:

```bash
npm run app:dev            # Vite dev server on :5173

# from the Android project dir:
CAPACITOR_DEV=1 npm run android:sync     # server.url → http://10.0.2.2:5173
```

`CAPACITOR_DEV=1` is the only switch that writes `server.url` (D15); a release
sync omits it and the shell loads the bundle.

## 3. Build and run

```bash
npm install
npm run app:assets          # optional: refresh icons/splash from public/logo.png
npm run app:build           # bundle src/ → mobile/www/
npm run android:sync        # copy config and plugins into android/
npm run android:open        # Android Studio: select a device, press Run
```

From the command line, with a device or emulator attached:

```bash
npm run android:run
```

Re-run `npm run android:sync` after changing `capacitor.config.ts`, adding a
plugin, or pulling a change to `mobile/www`. The `android/` directory is checked
in, so manifest, resources and icon changes belong in source control.

## 4. How a notification becomes a push

1. **Sign-in.** `NativeBridge` asks for the `POST_NOTIFICATIONS` permission
   (Android 13+ shows the system prompt) and calls `PushNotifications.register()`.
2. **Token.** FCM issues a registration token. The `registration` listener keeps
   it in `localStorage` and posts it to `POST /api/devices`, storing it against
   the signed-in account (`DeviceToken.token` is unique, so signing in on the
   same phone as another account re-points it).
3. **Write.** An action calls `notifyUser`, `notifyUsers` or `createBroadcast`.
   The row is written first, then `push.ts` decides who may see it — publish
   state, time window, visibility tags, and the participant list for an
   organizer update — and sends one FCM HTTP v1 message per device.
4. **Delivery.**
   - App in the background: Android shows the notification on the
     `event_invites` channel the app created at launch.
   - App in the foreground: `pushNotificationReceived` posts a local
     notification on the same channel and refreshes the bell.
5. **Tap.** `pushNotificationActionPerformed` marks the row read
   (`POST /api/notifications/…`), tells the bell to reload, and pushes the route
   carried in the payload — the same screen the bell row would open.
6. **Sign-out.** `authAPI.logout` sends the refresh token from the Keystore,
   revokes it server-side, then clears the in-memory access token and the
   persisted refresh token. The device is removed before the session ends.
7. **Cleanup.** When FCM answers `UNREGISTERED` for a token (app uninstalled,
   data cleared, token rotated) the row is deleted automatically.

## 5. Payload reference

The FCM message carries a `notification` block (title and body, shown by the OS)
and a `data` block, whose values are all strings:

| Key | Meaning |
| --- | ------- |
| `kind` | `individual` or `broadcast` — which route marks it read. |
| `type` | The notification type, e.g. `COMMENT_REPLY`, `EVENT_CREATED`. |
| `notificationId` | Individual row id, used for `POST /api/notifications/:id/read`. |
| `broadcastId` | Broadcast row id, used for `POST /api/notifications/broadcasts/:id/read`. |
| `route` | Where a tap leads. |

Routes mirror the bell exactly:

| Notification | Route |
| ------------ | ----- |
| New event / reminder / organizer update | `/events/<eventId>` |
| Announcement | `/#announcements` |
| Reply to a comment | `/events/<eventId>#comment-<commentId>` |
| Administrator or chat message | `/messages?chat=<chatId>` |
| Password reset / advice | `/profile` |
| Anything else with an event target | `/events/targetId>` |

## 6. Environment variables

| Variable | Where | Purpose |
| -------- | ----- | ------- |
| `FCM_SERVICE_ACCOUNT_JSON` | API (Vercel **and** `.env.local`) | Service-account key. Raw JSON, a base64 copy, or a document pasted by hand — the API reads all three. Unset disables push. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | API | Alias for the same value. |
| `GOOGLE_APPLICATION_CREDENTIALS` | API (file path) | Path to the key file. Handy locally, not on Vercel. |
| `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | API | The three fields separately, when a single JSON is awkward. |
| `FCM_PROJECT_ID` | API | Overrides the project inside the key. |
| `VITE_API_BASE` | Build time | The absolute API URL the app bundle talks to, e.g. `https://your-app.vercel.app/api`. Required for `app:build`. |
| `CAPACITOR_DEV` | Build time | Set to `1` to make the shell load a dev server instead of the bundle. |
| `CAPACITOR_SERVER_URL` | Dev only | Overrides the dev server URL (default `http://10.0.2.2:5173`). Ignored unless `CAPACITOR_DEV=1`. |

## 7. Testing

- **The device is registered:** after signing in, check
  `SELECT * FROM "DeviceToken";` — there should be one row for the account, with
  `appVersion` populated from the installed build.
- **FCM console:** Firebase → **Messaging** → **Send test message**, paste the
  token from the table. The app receives it through the same code path as a real
  notification.
- **Real events:** create and publish an event (broadcast), confirm a
  registration (individual), send an administrator message from the Users tab,
  or reply to a comment.
- **Foreground vs background:** with the app open the notification comes from
  the local-notification layer; with it closed it comes straight from FCM.
- **Logs:** `adb logcat | findstr Capacitor` (PowerShell) to watch plugin calls.

## 8. Release build

The APK is built by the `build-android` workflow, on a `v*` tag or by hand.

| Variable | Where | Notes |
| -------- | ----- | ----- |
| `FCM_GOOGLE_SERVICES_JSON` | Actions secret | Written to `android/app/google-services.json`. Never committed. Without it the app has no Firebase project, asks for no push token, and every notification goes nowhere. |
| `ANDROID_KEYSTORE_BASE64` | Actions secret | The release key, base64-encoded. |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | Actions secrets | Signing inputs. |
| `VITE_API_BASE` | Actions variable | Absolute API base for the Vite build. |

The workflow (`/build-android.yml`) runs `npm ci`, bundles the app, copies it
into the Android project, writes `google-services.json` from the secret, sets
the version, restores the signing key and builds with `./gradlew
assembleRelease`. On a `v*` tag the APK is also attached to a GitHub Release
with generated notes.

The version is set by the workflow: the code is the run number, so it never
goes backwards and a build always installs over the last one, and the name is
the release tag, so the app reports which build it is and the server can tell
two devices apart.

Switching from the debug to the release signing key forces one uninstall —
document it in the release notes.

## 9. Update check

The app checks for a newer release on every resume:

1. `GET https://api.github.com/repos/<owner>/<repo>/releases/latest`
2. Compare `tag_name` with `App.getInfo().version`
3. If newer, show a dismissible banner with a download action
4. Cache ~1 h; remember the dismissed version in `localStorage`
5. The download opens in a **Chrome Custom Tab** via `@capacitor/browser@8`, which
   returns to the app — the documented exception to "no App Links": an APK
   cannot be installed from inside the WebView.

No App Links intent filters are registered. Every non-app-origin URL — `wa.me`,
`t.me`, the release page — leaves the WebView via `Intent.ACTION_VIEW`.

## 10. Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| App shows a blank page | `cap sync` ran without `npm run app:build`; `mobile/www/` is empty. Re-run both. |
| Sign-in fails with 401 | `VITE_API_BASE` is unset. The app falls back to `/api`, which has no listener. |
| `GET /api/health` lists no `https://localhost` | `FRONTEND_URL` on the API omits the WebView origin. Add `https://localhost`. |
| No permission prompt, no token | Android 13+ permission was denied earlier. Re-enable it in the app's system settings and sign in again. |
| Token registers but no push arrives | `FCM_SERVICE_ACCOUNT_JSON` is unset or malformed on the API, or the API was not redeployed after adding it. |
| Push arrives but the tap opens the wrong screen | The row's `meta` is missing the id the route needs. |
| Logged-out phone still gets the old account's pushes | The device was removed offline. Signing in as the new account re-points the token; the stale row is also dropped when FCM reports it unregistered. |
| Cleartext error against a local server | Use `CAPACITOR_DEV=1` and `http://10.0.2.2:5173`; a release build only loads `https://localhost`. |
| Build fails asking for Java 21 | Install JDK 21 and point Android Studio at it. |
| In-place upgrade fails | The signing key changed. Back up the debug keystore outside the repo. |

## 11. Notes and limits

- The shell **does not need a network connection to start**: the Vite bundle
  renders the shell immediately. A network is needed only to reach the API for
  sign-in, events, notifications and so on.
- Push text generated by the API is English (the type labels such as *"New
  event"*); the notification's own content — an event title, an
  administrator's message — is carried through as written.
- A broadcast fans out to at most 2000 devices in one call
  (`MAX_PUSH_RECIPIENTS`). Everyone beyond that still sees the row in the bell,
  which is where eligibility is finally resolved.
- The APK is Android-only. There is no iOS project.

## 12. What is never committed

This repository is public. Five things never enter it, and each has exactly one
home elsewhere. **Environment files** — `.env.local`, `backend/.env` and any
other `.env*` — are ignored by the root `.gitignore`; the real values live in the
Vercel project settings and Actions variables, and only the two `.env.example`
templates are tracked, with empty or placeholder values. **Service-account keys**
— `firebase-adminsdk-key.json` at the root and `android/app/google-services.json`
— are ignored and live in the Firebase console and, for CI, as the Actions secret
`FCM_GOOGLE_SERVICES_JSON`. The FCM key the API uses
(`FCM_SERVICE_ACCOUNT_JSON`) is set only on the API's environment and is never
shipped inside the APK. **Signing material** — `*.jks`, `*.keystore`, `*.p12`
and `keystore.properties` — is ignored and backed up outside the repository; CI
receives it base64-encoded through Actions secrets. **User uploads** —
`backend/uploads/` holds real images and is ignored; production uploads go to
Vercel Blob. **Build output and generated state** — `node_modules/`, `.next/`,
`dist/`, `backend/dist/`, `mobile/www/`, `android/app/src/main/assets/public/`,
`*.tsbuildinfo` and `next-env.d.ts` — are ignored and regenerated by the build.
Before the first push, `git status --ignored` was checked to confirm all of the
above were excluded, and the staged tree was grepped for connection strings,
private keys, `AIza` API keys and `service_account` blobs: zero hits outside
the documentation and templates.

## 13. Device checklist

Run this on a physical phone after installing a build. It takes five minutes
and proves the whole chain without reading any source.

1. **Install.** Install the APK. The first screen is the app, not a blank page.
2. **Sign in.** Sign in as an administrator.
3. **Token row.** Approve the notification permission prompt. The token is
   now registered; the Profile screen shows the app version under
   *Notifications on this device*.
4. **Test push.** Tap **Send test notification** in Profile. It reports
   `sent to N`, and the notification arrives.
   - `0 devices registered` means no token is stored yet — reopen the app,
     accept the permission prompt, and try again.
   - `Push is not configured on the server` means `FCM_SERVICE_ACCOUNT_JSON`
     is unset on the API.
5. **Tap route.** Tap the notification. The app opens the screen it points at,
   the row is marked read in the bell, and the app stays in the foreground.
6. **Sign out.** Sign out. The device row is removed, and the test button
   reports `0 devices registered` for the next account.
7. **Second account.** Sign in as a regular user and repeat steps 3–5. That
   account receives only its own notifications — send an administrator message
   to confirm.
