# The Android app

The Android app is a [Capacitor](https://capacitorjs.com) shell around the same
Next.js application. It loads the deployed site in a WebView, so pages, the API
and the first-party auth cookies behave exactly as they do in a browser —
including the notification bell and the Messages section. On top of that the
shell adds **push notifications through Firebase Cloud Messaging**, wired into
the app's own notification system rather than beside it.

```
┌─────────────────────────── Android app ───────────────────────────┐
│  MainActivity (Capacitor WebView)                                 │
│    https://your-app.vercel.app  ── the whole Next.js app          │
│    + capacitor.js bridge                                          │
│        ├── @capacitor/push-notifications   FCM token, taps        │
│        ├── @capacitor/local-notifications  foreground + channel   │
│        └── @capacitor/app                  back button, resume    │
│                                                                    │
│  src/components/NativeBridge.tsx  (loaded by the web app)         │
│    sign-in  → POST /api/devices    { token }                      │
│    tap push → mark read + open the same screen as the bell row    │
│    sign-out → DELETE /api/devices                                 │
└────────────────────────────────────────────────────────────────────┘
                         │                    ▲
                         ▼                    │ FCM HTTP v1
   ┌─────────────── Vercel API ───────────────┴────────────┐
   │  notifyUser / notifyUsers / createBroadcast           │
   │    writes the bell row, then backend/src/utils/push.ts│
   │    resolves who may see it and sends the push         │
   └───────────────────────────────────────────────────────┘
```

The push layer is inert until a service account is configured. Without
`FCM_SERVICE_ACCOUNT_JSON` the API behaves exactly as it did before the app
existed.

## What is where

| Path | Role |
| ---- | ---- |
| `capacitor.config.ts` | App id, name, and the site the shell loads (`server.url`). |
| `android/` | The generated Capacitor project: Gradle, manifest, resources, app icons. |
| `mobile/www/` | A plain offline screen, used only if no server URL is configured. |
| `mobile/scripts/generate-assets.mjs` | Rebuilds the launcher icons and splash screens from `public/logo.png`. |
| `src/components/NativeBridge.tsx` | Registers the device, turns pushes into local notifications, routes taps. |
| `src/utils/nativePush.ts` | Small helpers: stored token, sign-out removal, bell refresh event. |
| `backend/src/routes/devices.ts` | `POST /api/devices` and `DELETE /api/devices`. |
| `backend/src/utils/push.ts` | FCM HTTP v1 delivery, access-token caching, stale-token cleanup. |
| `backend/src/utils/notifications.ts` | Sends the push right after each notification row is written. |
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

## 2. Point the shell at the deployment

`capacitor.config.ts` reads `CAPACITOR_SERVER_URL` when the native project is
synced. With it unset the shell loads `http://10.0.2.2:3000`, the Android
emulator's alias for the host machine, which is what `npm run dev` answers on:

```bash
npm run dev                                            # Next.js on :3000

# production
CAPACITOR_SERVER_URL=https://your-app.vercel.app npm run android:sync

# or, against your local server from the emulator
npm run android:sync
```

Only HTTPS is permitted outside the emulator: `network_security_config.xml`
allows cleartext for `10.0.2.2`, `localhost` and `127.0.0.1` and nothing else.

> On Windows the environment variable is set differently:
> `$env:CAPACITOR_SERVER_URL="https://your-app.vercel.app"; npm run android:sync`.

## 3. Build and run

```bash
npm install
npm run android:assets          # optional: refresh icons/splash from public/logo.png
npm run android:sync            # copy config and plugins into android/
npm run android:open            # Android Studio: select a device, press Run
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
   state, time window, visibility tags, and the participant list for an organizer
   update — and sends one FCM HTTP v1 message per device.
4. **Delivery.**
   - App in the background: Android shows the notification on the
     `event_invites` channel the app created at launch.
   - App in the foreground: `pushNotificationReceived` posts a local
     notification on the same channel and refreshes the bell.
5. **Tap.** `pushNotificationActionPerformed` marks the row read
   (`POST /api/notifications/…`), tells the bell to reload, and pushes the route
   carried in the payload — the same screen the bell row would open.
6. **Sign-out.** `AuthContext.logout` calls `DELETE /api/devices` while the
   session still answers, then unregisters locally, so the next account on the
   phone does not inherit the previous one's notifications.
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
| Anything else with an event target | `/events/<targetId>` |

## 6. Environment variables

| Variable | Where | Purpose |
| -------- | ----- | ------- |
| `FCM_SERVICE_ACCOUNT_JSON` | API (Vercel **and** `.env.local`) | Service-account key, raw JSON or base64. Unset disables push. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | API | Alias for the same value. |
| `GOOGLE_APPLICATION_CREDENTIALS` | API (file path) | Path to the key file. Handy locally, not on Vercel. |
| `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` | API | The three fields separately, when a single JSON is awkward. |
| `FCM_PROJECT_ID` | API | Overrides the project inside the key. |
| `CAPACITOR_SERVER_URL` | Build time | The site the shell loads; read by `cap sync`, not by Vercel. |

## 7. Testing

- **The device is registered:** after signing in, check
  `SELECT * FROM "DeviceToken";` — there should be one row for the account.
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

1. Bump `versionCode` / `versionName` in `android/app/build.gradle`.
2. Add a signing config (Android Studio → **Build → Generate Signed App Bundle /
   APK**, or a `signingConfigs` block fed from environment variables).
3. Build:

   ```bash
   npx cap build android                     # AAB for the Play Store
   npx cap build android --androidreleasetype APK
   ```

4. Upload the `.aab` to the Play Console. The package name
   `club.kolymafia.eventinvites` is the app's permanent identity.

Remember to sync the production URL **before** building:

```bash
CAPACITOR_SERVER_URL=https://your-app.vercel.app npm run android:sync
```

## 9. Troubleshooting

| Symptom | Likely cause |
| ------- | ------------ |
| App shows the "no server is configured" screen | `cap sync` ran without `CAPACITOR_SERVER_URL`. Re-run it with the URL set. |
| `google-services.json not found, google-services plugin not applied` | The file is missing from `android/app/`. Push will not work until it is added. |
| No permission prompt, no token | Android 13+ permission was denied earlier. Re-enable it in the app's system settings and sign in again. |
| Token registers but no push arrives | `FCM_SERVICE_ACCOUNT_JSON` is unset or malformed on the API, or the API was not redeployed after adding it. |
| Push arrives but the tap opens the wrong screen | The row's `meta` is missing the id the route needs (for example `meta.chatId`); the bell would be unable to open it either. |
| Logged-out phone still gets the old account's pushes | The device was removed offline. Signing in as the new account re-points the token; the stale row is also dropped when FCM reports it unregistered. |
| Cleartext error against a local server | Use `10.0.2.2` from the emulator, or HTTPS from a device; only those hosts permit cleartext. |
| Build fails asking for Java 21 | Install JDK 21 and point Android Studio at it. |

## 10. Notes and limits

- The shell **needs a network connection**: it renders the live site, not a
  bundled copy. Reproducing the app offline would mean making every dynamic
  route static (`/events/<id>`, `/events/key/<key>`), which is a rewrite of the
  frontend, not a packaging change.
- Push text generated by the API is English (the type labels such as
  *"New event"*); the notification's own content — an event title, an
  administrator's message — is carried through as written.
- A broadcast fans out to at most 2000 devices in one call
  (`MAX_PUSH_RECIPIENTS`). Everyone beyond that still sees the row in the bell,
  which is where eligibility is finally resolved.
- The web and backend sides are platform-neutral, so an iOS build is
  `npm i @capacitor/ios && npx cap add ios` plus an APNs key; only the FCM
  project setup differs.

## 11. What is never committed

This repository is public. Five things never enter it, and each has exactly one
home elsewhere. **Environment files** — `.env.local`, `backend/.env` and any
other `.env*` — are ignored by the root `.gitignore`; the real values live in
the Vercel project settings, and only the two `.env.example` templates are
tracked, with empty or placeholder values. **Service-account keys** —
`firebase-adminsdk-key.json` at the root and `android/app/google-services.json`
— are ignored and live in the Firebase console and, for CI,
as the Actions secret `FCM_GOOGLE_SERVICES_JSON`. The FCM key the API uses
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
