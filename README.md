# Event Invites

A web application for managing event invitations: administrators create and
customize events, and registered users sign up for them.

## Stack

| Layer      | Technology                                     |
| ---------- | ---------------------------------------------- |
| Frontend   | React 18, React Router, Vite, TypeScript       |
| Backend    | Node.js, Express 5, TypeScript, Zod            |
| Database   | PostgreSQL via Prisma ORM, reached through Hyperdrive or directly |
| Uploads    | Local disk in development, Vercel Blob in production |
| Auth       | JWT access + refresh tokens in HttpOnly cookies |
| Mobile     | Capacitor Android shell (WebView) + FCM push   |
| Deployment | GitHub Pages for the app, Vercel for the API, Neon for the data |

## Getting started

```bash
npm install          # installs the root workspace and backend/
cp backend/.env.example backend/.env
# set DATABASE_URL in backend/.env to a PostgreSQL instance
npm run db:deploy    # apply migrations
npm run db:seed      # create the default accounts and sample events
npm run dev          # Next.js on :3000, serving the pages and the API
```

Open http://localhost:3000.

> **PostgreSQL is required.** An earlier version used a SQLite file, which
> cannot work on a serverless host: the filesystem is ephemeral, so every deploy
> and cold start would wipe the database. Point `DATABASE_URL` at any
> PostgreSQL server — Neon, Supabase, or one you run locally.

### Default accounts

| Name  | Phone         | Password | Role           |
| ----- | ------------- | -------- | -------------- |
| Admin | `+1 555 0100` | `Admin`  | Administrator  |
| Mark  | `+1 555 0142` | `Mark`   | Regular user   |

Passwords match the account name, and login accepts a **name, phone number or
email**, so `Admin` / `Admin` signs the administrator straight in. Both
accounts are (re)created by `npm run db:seed`.

## Accounts and authentication

Registration asks for a **name (or nickname) and a phone number**; email is
optional. Phone numbers are the identity anchor: they are stored twice — as
typed for display, and as a digits-only `phoneKey` — so `+1 (555) 010-0`,
`1-555-0100` and `+15550100` are all the same account. That key is unique, so a
number cannot be registered twice.

A password is optional at sign-up. When it is omitted the phone number becomes
the temporary password, and the profile page explains how to replace it.

Returning users are signed in automatically: a short-lived access token and a
long-lived refresh token are stored in HttpOnly cookies, and the frontend
silently calls `/api/auth/refresh` when the access token expires.

## Roles

Roles live in one registry, `backend/src/utils/roles.ts`, and are published to
the client at `GET /api/auth/roles`. Adding a role is a single entry there —
no migration and no schema change, because `User.role` is a plain string. Two
exist today:

- **USER** — signs up for events, manages their own profile.
- **ADMIN** — everything a user can do, plus: create/edit/delete events, manage
  participant lists, confirm, move and remove registrations, and grant or
  revoke roles.

Each role carries a `rank`, so `requireRole('ADMIN')` and the matching
`hasRole(user, 'ADMIN')` on the client keep working for any future role with a
higher rank.

## Features

### Home page

The home page is a list of sections rendered from `HOME_SECTIONS` in
`src/screens/HomePage.tsx`. Only **upcoming events open for
registration** is included for now; adding another section is a single entry in
that registry. On each event card a signed-in visitor gets a **Join** button per
participant list, and a visitor gets **Participate**, which opens the login
window.

### Banners

The hero above the events is a banner layout: a **main** banner that rotates
through its ads and **side** banners that hold a single ad. Administrators build
ads on the Admin dashboard under Banners, in five types: a cover, a progress
counter, a poll, contact buttons, and an announcement. Ads are ordered per slot,
toggled on or off, and can be saved to a template library to be reused. The main
slot's rotation interval is configurable.

A **cover** carries an image, solid-color or gradient background with two texts
configured the way an event page styles its title and body:

- a caption — its own alignment, font color, font family and font size;
- a detailed description — its own alignment, font color, font family and font
  size, so the two texts never fight over the same style;
- a vertical alignment — top, middle or bottom — that decides where the text
  block sits inside the banner.

### Avatars

Uploading an avatar opens an overlay that fits within the viewport and scrolls
when the content is taller than the screen. The image is cover-fitted inside a
circular frame and can be dragged, zoomed, rotated, and flipped horizontally or
vertically. The result is rendered to a canvas and uploaded as a PNG.

### Events

Each event has a title, short description (shown in the list), detailed
description, cover image, date and time, and address. The cover can come from a
URL, be uploaded from the local device, or be left out. Optional extras: a host
picked from the user base, a price, and organizer contact details that start
from the creator's own phone or email and can be edited.

New events are created with a **Main List** and a **Waitlist**. Administrators
can add more lists, rename them, promote one to default, and delete them — an
event always keeps at least one list, and a list holding registrations must be
emptied first.

Every event gets a unique key at creation time, so a specific page is reachable
two ways:

- by URL — `/events/<id>`
- by key — `/events/key/<key>`

Unpublished events are only visible to administrators.

### Page layout and styling

The title, date and time always render in the page header. The remaining
elements (cover image, detailed description, address, host, price, organizer
contact, participant lists) can be reordered, removed, re-added, and set to
either sit **side-by-side** in a two-column grid or span the **full width**.

Styling covers the page background color, font color and font type (six font
choices), plus per-element background and font color overrides with a per-row
clear.

The cover image can carry text: a **caption** and a **detailed description**,
each with its own alignment, font color, font style and font size, plus a
**vertical alignment** deciding where the block sits over the image. The same
controls style the cover banner's two texts, and with no image at all the text
alone becomes the cover.

### Administrators and participants

On an event page and on the registrations screen an administrator sees, for each
registered user, a **Contact** dropdown offering *Call* for the phone number in
their profile and a link for each social profile, alongside a **Confirm**
toggle and a control to move the participant to another list. Confirmed
participants are highlighted in the participant list.

### Activity log and feedback

The administrator's **Status** tab ends in an activity log, newest first, with
a filter row per category and a sort toggle (newest/oldest first). It records:

- **Account registrations** — and whether the account arrived as a guest or
  with an invitation.
- **Guest confirmations** — every promotion to a regular user.
- **Password reset requests** — when they were made, by whom.
- **Event creation** — plus an *upcoming event* line the first time an event
  comes within 48 hours of starting.
- **New comments and replies** — **off by default**; the toggle at the top of
  the log turns it on.
- **Banner changes** — created, changed and removed ads, per banner slot; the
  slot's *Log changes* checkbox in the banner editor controls it.
- **Feedback** — messages sent through the feedback form.

Above the log, the **banner control panel** appears while the home page shows a
counter or a poll banner:

- A counter banner shows its current value, editable here and saved straight to
  the banner, plus every reference users copied out of its details text — the
  @handles are recorded per user, with a copy count for repeats and the time of
  the last one. A copy is attributed only when the visitor is signed in.
- A poll banner shows the votes per option and, under each, who voted: name,
  contact details and when.

Every entry has an **✕** in its corner: the first click arms the entry, the
second removes it. The **Clear** button beside the sort control asks for
confirmation in a centred dialog — warning that every entry goes and cannot
be brought back — and then empties the log. An upcoming-event announcement is
remembered beside the log, so a cleared log does not re-announce an event that
was already announced.

Any signed-in user can send feedback from the header menu (**Feedback** under
the user menu on desktop, in the left drawer on mobile): a rich-text message
like the event description, plus one attachment of up to 5 MB. In the log, a
feedback entry shows the sender's name and time; opening it shows the message
and a download link for the attachment — in a window on desktop, inline
between the entries on mobile. The message is sanitized on the server with the
same allowlist as event descriptions.

The header also carries a notification bell. There is nothing to report yet, so
its panel says so; the button and panel are the place future notifications
will appear.

### Notifications

The bell holds two kinds of notification.

**Broadcasts** — one row each, shown to every user they apply to: a new event
(visible under the same publish, time and tag rules as the event page), an
event reminder as it comes within 48 hours, an organizer's update to everyone
registered for that event, and a new banner announcement. Eligibility is
worked out when the bell is read, so a store's access rules and a user's tags
decide what reaches them without per-user rows.

**Individual** — one row per user: replies to their comment, a banned comment
or a comment block, an administrator's message, a registration confirmation, a
move to another participant list, a removal from a list, and a prepared
password reset.

Clicking a row does what it says: a comment opens that comment on the event
page, an event notification opens the event, an announcement opens the banner
on the home page, and an administrator's message opens the message in a
panel — beside the page on a wide screen, centred over it on a narrow one.
Every row can be marked read; the panel can mark everything read at once.
Deleting an individual notification removes it for good, while deleting a
broadcast only hides it from that user — it leaves the system when the event
or the announcement it belongs to is deleted.

Organizer updates are sent from the registrations screen (*Notify
participants*), and an administrator can write to a user from the users tab or
answer a feedback message from the Status tab.

#### Push notifications (Android)

The same notifications reach the Android app through Firebase Cloud Messaging.
Writing a notification and sending a push are one act: `notifyUser`,
`notifyUsers` and `createBroadcast` in `backend/src/utils/notifications.ts`
each hand the row they just wrote to `backend/src/utils/push.ts`, so a push can
never exist without the bell row it belongs to, or the other way round.

Eligibility is resolved at push time with the rules the bell already applies —
publish state, the time window, the event's visibility tags and, for an
organizer update, the participant list. A broadcast therefore goes only to the
people who would see it, and the payload carries the row's id and the route to
open; tapping it marks the notification read and opens that screen, exactly as
clicking it in the bell does. Signing in registers the device against the
account, and signing out removes it before the session ends.

Push is **off until a service account is configured**: with no
`FCM_SERVICE_ACCOUNT_JSON` set, `push.ts` returns immediately and the app is
unchanged. See [`docs/ANDROID.md`](docs/ANDROID.md) for the Firebase setup, the
build steps and how the pieces fit together.

### Event discussion

Every event page ends in a comment section that works as a chat for everyone
who can open the event.

- Anyone who can open the event reads the discussion; signed-in regular users
  (guests wait for approval) write in it. A blocked user still reads but cannot
  post.
- **Reply** nests a comment inside a thread. **Quote** under a comment quotes it
  inline, and the ❝ button on any section of the page quotes that section's
  text — the quote is stored on the comment, so the thread stays shallow.
- An administrator can **pin** one comment, which is shown first while every
  other comment stays in time order.
- An administrator is shown by the **Administrator** badge alone — no avatar
  ring and no name border, even when they also host the event. A host who is
  not an administrator is outlined in blue and an organizer in green, on the
  avatar and the name, with matching badges. A user holding several of these
  roles keeps all of their badges.
- An administrator can **ban** a comment (hidden from everyone but
  administrators, so the decision can be undone), **delete** any comment
  (the author can delete their own; removed comments keep their replies in
  place), or **block a user from commenting on that event**. The blocked users
  of the event are listed in the section and can be unblocked.

The discussion follows the visibility of the event itself: an unpublished event
is open only to administrators, and a tag-restricted event only to holders of
its tags, exactly like the event page.

## Project layout

```
wrangler.jsonc             Cloudflare Worker: the API, the assets, Hyperdrive
vercel.json                the Vercel deployment, kept as a second option
neon.ts                    Neon config (infrastructure as code)

worker/
  index.ts                 the Worker entry: the Express app behind node:http
  tsconfig.json            type-checking for the Worker and the API
web/
  vite.config.ts           the web build: the same app, from the same src/
  dist/                    the built assets the Worker serves (gitignored)
vite.shared.ts             the Vite settings both bundles share

backend/
  package.json            the API workspace (installed by the root npm install)
  scripts/                deploy-migrations.mjs, a DATABASE_URL preflight
  prisma/schema.prisma    data model (PostgreSQL)
  prisma.config.ts        where the Prisma CLI reads the connection URL from
  prisma/migrations/      checked-in migrations applied on deploy
  prisma/seed.ts          default accounts and sample events
  src/app.ts              Express app: middleware and routes, no listen()
  src/index.ts            long-running bootstrap (dev, Railway, Render, a VM)
  src/types.ts            the request shape, and how a query value is read
  src/middleware/         auth, role guard, error handling
  src/routes/             auth, events, users, admin, tags, upload, devices
  src/utils/              Prisma client, Zod schemas, roles, storage, push
app/                      Next.js App Router pages and the /api catch-all
  api/[...path]/route.ts  the Vercel serverless entry: it adapts the Express app
                          to a route handler, so pages and API share an origin
src/
  components/             layout, auth modal, event card, bell, native bridge
  context/                auth session and auth-modal state
  i18n/                   language catalogues (English, Russian) and provider
  screens/                home, event, profile, admin screens
  utils/                  api client, asset URLs, roles, push bridge helpers
capacitor.config.ts       Android shell: app id, name and the server it loads
mobile/
  app/                    Vite entry: index.html, main.tsx, App.tsx (route table)
  www/                    Vite build output, bundled into the APK (gitignored)
  vite.config.ts          the APK bundle
  scripts/                generate-assets.mjs: icons and splash from public/logo.png
android/                  Capacitor Android project (Gradle, manifest, resources)
docs/ANDROID.md           Firebase setup, the build steps, and how push is wired
docs/CLOUDFLARE.md        the Worker's setup, its secrets, and how to deploy it
```

The app is built twice from one `src/`: for the browser and for the Android
WebView. `mobile/app/App.tsx` holds the route table, and the alias
`next/link` → `src/utils/navigation.router.tsx` means no source file has to
know which bundle it is in. The web build is served by the Worker from the
same origin as the API, so the browser's calls are same-origin and need no
CORS preflight.

`app.ts` and `index.ts` are split deliberately: the serverless entries import
`app` as a request handler and never call `listen`, while `npm run dev:backend`
and any long-running host start a normal server.

## Notes on the data model

Enums and JSON are stored as strings rather than native column types, so the
same schema works on PostgreSQL without depending on provider-specific features.
`User.role`, `Registration.status`, `User.socialLinks`, `Event.pageStyle` and
`Event.layout` are parsed and serialized in `backend/src/utils/serialize.ts`, so
the JSON reaching the frontend is always a real object or array.

`User.email` is nullable and `User.phoneKey` carries the unique constraint,
because a phone number — not an email address — identifies an account.

`DeviceToken` is the one row per app installation that receives push
notifications. Its `token` is unique, so a phone that signs in as another
account re-points the row instead of leaving one that would keep delivering the
previous owner's notifications.

## Android app

The Android app is a Capacitor shell around the same `src/` the browser uses.
Instead of loading the deployed site in a WebView, the shell ships a **Vite
build** of `src/` bundled into `mobile/www/` — React Router replaces the
router via an alias (`next/link` → `src/utils/navigation.router.tsx`), and auth
uses `Authorization: Bearer` headers against the deployed API, not cookies (the
WebView's `https://localhost` origin makes cookies third-party, and the Android
WebView drops them by default). Push notifications come from Firebase Cloud
Messaging and are delivered into the app's own notification system, never in
place of it.

```bash
npm run app:build                     # bundle src/ → mobile/www/
VITE_API_BASE=https://eventinvites.mystdwellerdreams.workers.dev/api npm run app:build
npm run android:sync                  # cap sync, copies www into android/
npm run android:open                  # Android Studio: select a device, press Run
```

For live reload during development:

```bash
npm run app:dev &
CAPACITOR_DEV=1 npm run android:sync  # shell points at the Vite dev server
```

The three pieces that make push work:

| Piece | Where | What it does |
| ----- | ----- | ------------ |
| Device registration | `src/components/NativeBridge.tsx`, `POST /api/devices` | On sign-in the FCM token is stored against the account with `appVersion`; on sign-out the device is removed before the session ends. |
| Delivery | `backend/src/utils/push.ts` | Sends an FCM HTTP v1 message for every notification written. Off unless a service account is configured. |
| Linking | `data` payload + `NotificationBell` | Each push carries the row's id and a route: tapping it marks the notification read and opens the screen, exactly like clicking the bell row. |

[`docs/ANDROID.md`](docs/ANDROID.md) has the Firebase setup, the build steps, a
payload reference and troubleshooting. Push needs no changes to the web
deployment: with `FCM_SERVICE_ACCOUNT_JSON` unset the push layer is a no-op.

## Deploying

The application is four pieces, on four hosts:

```
GitHub Pages          the single-page app
Vercel                the API
Neon                  the database and the uploads
GitHub Actions        the builds and the deploys
```

[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) has the step-by-step: the Vercel
project and its environment variables, the GitHub Pages repository and its
variables, the Android release key, and the secrets the workflows need.

| Part | Where | Cost |
| ---- | ----- | ---- |
| Web app | GitHub Pages | free, or $4/month for a private source repository |
| API | Vercel Hobby | free, for non-commercial use |
| Database and uploads | Neon | free |
| Builds | GitHub Actions | free |

The app and the API are on different hosts, so the browser's calls are
cross-origin: the API answers with CORS headers for the site's origin, and
the session is a cookie marked `SameSite=None`. **The Android app is not
affected by that** — it authenticates with a bearer token and never uses a
cookie, so it keeps working in every browser.

Two things are worth knowing before deploying:

- **GitHub Pages is free for public repositories only.** For a private one it
  needs GitHub Pro, or the site has to be published from a separate public
  repository. The source can stay private either way.
- **Vercel's Hobby plan is for non-commercial use.** Asking for donations
  does not count; taking payments does.

The build writes a copy of the app as `404.html`, because GitHub Pages has no
single-page fallback and would otherwise answer a deep link such as
`/events/key/abc` with its own error page. To see it behave that way locally:

```bash
npm run web:build
npm run web:preview   # serves web/dist the way GitHub Pages does
npm run web:check     # checks that the deep links reach the app
```

### The other target

The Cloudflare Worker deployment is still in the repository and still works:
`worker/` holds the entry, `wrangler.jsonc` the configuration, and
`npm run deploy:cloudflare` deploys it. It serves the API and the web app
from one origin, which avoids the cross-site cookies entirely, but it costs
$5 a month for the paid plan — the free plan's ten milliseconds of CPU per
request is less than the password hashing alone takes. See
[`docs/CLOUDFLARE.md`](docs/CLOUDFLARE.md).

## Deploying to Vercel

The Vercel deployment is still there and still works: **one Vercel project**
rooted at the repository root. The root `vercel.json` runs `prisma generate &&
prisma migrate deploy && next build`, and `app/api/[...path]/route.ts` mounts
the Express app as the only serverless function, so the pages and the API
share one origin and one domain.

| Setting        | Value                                                      |
| -------------- | ---------------------------------------------------------- |
| Root Directory | the repository root                                        |
| Build Command  | from `vercel.json`: generate, migrate, `next build`        |
| Function       | `app/api/[...path]/route.ts` — 30 s, 1 GB                  |

Environment variables, on **Production and Preview** alike (the build applies
migrations, so preview builds need them too):

| Variable                | Required | Purpose                                        |
| ----------------------- | -------- | ---------------------------------------------- |
| `DATABASE_URL`          | yes      | PostgreSQL connection string                   |
| `JWT_SECRET`            | yes      | signs access tokens                            |
| `REFRESH_SECRET`        | yes      | signs refresh tokens                           |
| `BLOB_READ_WRITE_TOKEN` | yes      | the Vercel Blob store for uploaded images       |
| `BLOB_STORE_ID`         | no       | identifies the store, for reference             |
| `NEON_STORAGE_BUCKET`   | yes      | the bucket the images live in                  |
| `TURNSTILE_SECRET_KEY`  | no       | server-side captcha check                      |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | no | inlines the captcha widget                |
| `FCM_SERVICE_ACCOUNT_JSON` | no    | enables push to the Android app                |
| `FRONTEND_URL`          | no       | origins allowed to call the API; include `https://localhost` for the APK |

Generate secrets with `openssl rand -base64 32`.

### Provisioning

1. **PostgreSQL.** Neon, Supabase or Vercel Postgres. Copy the connection
   string. Strip any surrounding quotes.
2. **Object storage.** A Vercel Blob store: create one in the project under
   Storage, and copy its token. Without it, uploads fall back to the ephemeral
   filesystem and are lost on the next cold start. An S3-compatible store —
   Neon Object Storage among them — can be used instead by setting the
   `AWS_*` variables and leaving `BLOB_READ_WRITE_TOKEN` unset.

### Cookies and CORS

Because the pages and the API are one origin, the web auth cookies are ordinary
first-party `SameSite=Lax; HttpOnly` cookies and CORS never comes into play.
`FRONTEND_URL` lists further origins that may call the API, comma-separated —
the Android app's `https://localhost` WebView is one. When it is set in
production, `backend/src/utils/cookies.ts` switches the auth cookies to
`SameSite=None; Secure` so those extra origins are served as well; either way
every set and clear goes through the same helper, so a logout or refresh cannot
leave a stale cookie behind. CORS echoes only the listed origins: with it unset
no CORS headers are emitted at all, because reflecting an arbitrary origin
alongside credentials would let any site read authenticated responses.

The APK does not use cookies at all: it authenticates with `Authorization:
Bearer` headers (see `src/utils/authToken.ts`), and `FRONTEND_URL` must include
`https://localhost` so the CORS preflight for that header is allowed. `GET
/api/health` reports `corsOrigins` — check that it lists the WebView origin
before anything else.

`GET /api/health` reports `corsOrigins` and `crossSiteCookies`, which is the
quickest way to confirm the deployment is configured as intended.

### Uploaded image URLs

Uploads are stored in the database as `/uploads/<file>`, which resolves against
the current origin — correct while one server serves both, which is what the
Worker does. If the API ever moves to another origin, `resolveAssetUrl()` in
`src/utils/api.ts` prefixes those paths with the API's own origin, and
absolute or `data:` URLs pass through untouched. It is a no-op while the API
and the page share an origin, so one code path serves local development,
production and the Android app.

### Migrating an existing database

`prisma migrate deploy` applies only migrations that the target database has not
already recorded. A database created with the old `prisma db push` workflow has
no `_prisma_migrations` rows, so the initial migration would try to run again
against existing tables and fail. Either mark it as applied without running it:

```
npx prisma migrate resolve --applied 20260101000000_init
```

or point at an empty database.

## Scripts

| Command                   | Description                                    |
| ------------------------- | ---------------------------------------------- |
| `npm run dev`             | Next.js app and API (pages + `/api`)           |
| `npm run dev:backend`     | Express API on its own, with reload            |
| `npm run build`           | The Prisma client and the web app for the Worker |
| `npm run build:next`      | Production build of the Next.js app            |
| `npm start`               | Run the Next.js build                          |
| `npm run lint`            | Lint the Next.js app                           |
| `npm run db:generate`     | Generate the Prisma client                     |
| `npm run db:migrate`      | Create a new migration                         |
| `npm run db:deploy`       | Apply migrations (used on deploy)               |
| `npm run db:check`        | Preflight the migrations without applying them |
| `npm run db:seed`         | Seed default accounts and sample events        |
| `npm run db:studio`       | Open Prisma Studio                             |
| `npm run typecheck`     | Type-check the app and the API (`tsc --noEmit`) |
| `npm run app:dev`       | Vite dev server for the APK bundle |
| `npm run app:build`     | Bundle `src/` into `mobile/www/` |
| `npm run app:sync`      | `app:build` then `cap sync android` |
| `npm run android:assets`  | Generate icons and splash from `public/logo.png` |
| `npm run android:sync`    | Build the web config into the Android project  |
| `npm run android:open`    | Open `android/` in Android Studio              |
| `npm run android:run`     | Install and run on a connected device/emulator |
| `npm run android:build`   | Build an APK or AAB from the Android project   |
| `npm run web:build`       | Bundle `src/` into `web/dist/` for the site    |
| `npm run web:preview`     | Serve `web/dist` the way GitHub Pages does     |
| `npm run web:check`       | Check that the deep links reach the app         |
| `npm run android:apk`     | Build the signed release APK                   |
| `npm run worker:dev`      | The Worker on :8787, with the app and the API   |
| `npm run worker:deploy`   | Deploy the Worker                              |
| `npm run worker:check`    | Check a running Worker the way the app uses it  |
| `npm run worker:typecheck` | Type-check the Worker and the API              |
| `npm run cf:dev-vars`     | Write `.dev.vars` for the local Worker         |
| `npm run deploy:cloudflare` | The migrations, then the Worker               |
| `npm run storage:check --workspace=backend` | Write, read and remove one uploaded file |

Uploaded images go to `backend/uploads` in development, served from
`/uploads`. When an object store is configured they are written to it
instead, and the database stores the store's own URL.

Vercel Blob keeps the access level of the store rather than of the request,
and the app remembers which one it is talking to, so it does not have to probe
on every upload. A **public** store is answered with a redirect from
`/uploads/<file>`, so browsers fetch the bytes from the CDN without invoking
the API. A **private** store is read with the token and served by the API,
which is the only way a private store can be read at all. Either way
`/uploads/<file>` is what the browser requests, so one code path covers the
disk, Vercel Blob and an S3-compatible store. The `uploads` directory is
excluded from version control.
