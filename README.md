# Event Invites

A web application for managing event invitations: administrators create and
customize events, and registered users sign up for them.

## Stack

| Layer      | Technology                                     |
| ---------- | ---------------------------------------------- |
| Frontend   | Next.js App Router, React 18, TypeScript       |
| Backend    | Node.js, Express, TypeScript, Zod              |
| Database   | PostgreSQL via Prisma ORM                      |
| Uploads    | Local disk in development, Vercel Blob in production |
| Auth       | JWT access + refresh tokens in HttpOnly cookies |
| Mobile     | Capacitor Android shell (WebView) + FCM push   |
| Deployment | Vercel (Next.js pages and serverless API)      |

## Getting started

```bash
npm install          # installs both workspaces
cp backend/.env.example backend/.env
docker compose up -d # local PostgreSQL on :5432
npm run db:deploy    # apply migrations
npm run db:seed      # create the default accounts and sample events
npm run dev          # backend on :4000, frontend on :3000
```

Open http://localhost:3000.

> **PostgreSQL is required.** The app originally used a SQLite file, which
> cannot work on Vercel: serverless filesystems are ephemeral, so every deploy
> and cold start would wipe the database. `docker compose up -d` gives you the
> same engine locally.

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
`frontend/src/pages/HomePage.tsx`. Only **upcoming events open for
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
vercel.json               single-project config (both halves, same origin)
api/[...path].ts          serverless entry for that single-project layout
docker-compose.yml        local PostgreSQL for development
tsconfig.vercel.json      typechecks the root serverless entry
neon.ts                   Neon config (infrastructure as code)

backend/
  vercel.json             API-project config: function + migrations, no static output
  .vercelignore           applied when backend/ is the Vercel project root
  api/index.ts            serverless entry for the API project
  scripts/                deploy-migrations.mjs, a DATABASE_URL preflight
  prisma/schema.prisma    data model (PostgreSQL)
  prisma/migrations/      checked-in migrations applied on deploy
  prisma/seed.ts          default accounts and sample events
  src/app.ts              Express app: middleware and routes, no listen()
  src/index.ts            long-running bootstrap (dev, Railway, Render, a VM)
  src/middleware/         auth, role guard, error handling
  src/routes/             auth, events, users, admin, tags, upload, devices
  src/utils/              Prisma client, Zod schemas, roles, storage, push
app/                      Next.js App Router pages and the /api catch-all
  api/[...path]/route.ts  adapts the Express app to a route handler
src/
  components/             layout, auth modal, event card, bell, native bridge
  context/                auth session and auth-modal state
  i18n/                   language catalogues (English, Russian) and provider
  screens/                home, event, profile, admin screens
  utils/                  api client, asset URLs, roles, push bridge helpers
capacitor.config.ts       Android shell: app id, name and the server it loads
mobile/
  www/                    offline screen, used only if no server is configured
  scripts/                generate-assets.mjs: icons and splash from public/logo.png
android/                  Capacitor Android project (Gradle, manifest, resources)
docs/ANDROID.md           Firebase setup, the build steps, and how push is wired
```

`app.ts` and `index.ts` are split deliberately: Vercel imports `app` as a
request handler and never calls `listen`, while `npm run dev` and any
long-running host still start a normal server. There are two serverless entries
because there are two project roots: `api/[...path].ts` for the single-project
layout and `backend/api/index.ts` for the split one. Both export the same app.

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

The Android app is a Capacitor shell around the same Next.js app: it loads the
deployed site in a WebView, so pages, the API and the first-party auth cookies
behave exactly as they do in a browser. Push notifications come from Firebase
Cloud Messaging and are delivered into the app's own notification system, never
in place of it.

```bash
npm run android:assets                     # icons and splash from public/logo.png
CAPACITOR_SERVER_URL=https://your-app.vercel.app npm run android:sync
npm run android:open                       # opens the project in Android Studio
```

The three pieces that make push work:

| Piece | Where | What it does |
| ----- | ----- | ------------ |
| Device registration | `src/components/NativeBridge.tsx`, `POST /api/devices` | On sign-in the FCM token is stored against the account; on sign-out the device is removed before the session ends. |
| Delivery | `backend/src/utils/push.ts` | Sends an FCM HTTP v1 message for every notification written. Off unless a service account is configured. |
| Linking | `data` payload + `NotificationBell` | Each push carries the row's id and a route: tapping it marks the notification read and opens the screen, exactly like clicking the bell row. |

[`docs/ANDROID.md`](docs/ANDROID.md) has the Firebase project setup, the
render/build steps, a payload reference and troubleshooting. Push needs no
changes to the web deployment: with `FCM_SERVICE_ACCOUNT_JSON` unset the push
layer is a no-op.

## Deploying to Vercel

The repository supports two layouts:

- **Two projects (recommended).** A frontend project rooted at `frontend/` and
  an API project rooted at `backend/`. The frontend calls the API across
  origins.
- **One project.** The root `vercel.json` still builds both halves together and
  puts the API on the same origin. Useful while developing, but not the
  recommended production shape.

### Two-project layout

Create **two** Vercel projects from the same repository, with different Root
Directory settings.

#### API project

Root Directory: `backend`. Uses `backend/vercel.json`, which exposes
`backend/api/index.ts` as the serverless function and runs
`prisma generate && prisma migrate deploy && tsc`.

Environment variables:

| Variable                | Required | Purpose                                       |
| ----------------------- | -------- | --------------------------------------------- |
| `DATABASE_URL`          | yes      | PostgreSQL connection string                  |
| `JWT_SECRET`            | yes      | signs access tokens                           |
| `REFRESH_SECRET`        | yes      | signs refresh tokens                          |
| `BLOB_READ_WRITE_TOKEN` | yes      | object storage for uploaded images            |
| `FRONTEND_URL`          | **yes**  | the frontend's origin, e.g. `https://app.vercel.app` |

`FRONTEND_URL` is what enables cross-origin cookies and CORS. Set it to the
frontend URL **after** deploying the frontend, or copy the predicted URL from
the project settings, then redeploy the API.

#### Frontend project

Root Directory: `frontend`. Uses `frontend/vercel.json`: a static Vite build
with an SPA rewrite.

| Variable         | Required | Purpose                                          |
| ---------------- | -------- | ------------------------------------------------ |
| `VITE_API_BASE`  | **yes**  | the API origin, e.g. `https://api.vercel.app/api` |

Deploy the **API first**, then the frontend, so `VITE_API_BASE` has something to
point at.

### Provisioning

1. **PostgreSQL.** Neon, Supabase or Vercel Postgres. Copy the connection
   string. Strip any surrounding quotes.
2. **Blob.** Create a Blob store in the API project. Without it, uploads fall
   back to the ephemeral function filesystem and are lost on the next cold
   start.

Generate secrets with `openssl rand -base64 32`.

### Why the cookies change

`vercel.app` is on the Public Suffix List, so `app.vercel.app` and
`api.vercel.app` are **cross-site**, not merely cross-origin. SameSite=Lax
cookies would never be sent, which breaks sign-in with no visible error.

When `FRONTEND_URL` is set and `NODE_ENV=production`, `backend/src/utils/cookies.ts`
switches the auth cookies to `SameSite=None; Secure; HttpOnly; Path=/`. Every
cookie deletion goes through the same helper, so a logout or refresh cannot
leave a stale cookie behind.

CORS only echoes origins listed in `FRONTEND_URL` (comma-separated for several).
With it unset no CORS headers are sent at all, because reflecting an arbitrary
origin alongside credentials would let any site read authenticated responses.

### Uploaded image URLs

Uploads are stored in the database as `/uploads/<file>`. That resolves against
the API origin, which is correct only when one server serves both. In the
two-project layout `resolveAssetUrl()` in `frontend/src/utils/api.ts` prefixes
those paths with the API origin, and absolute or `data:` URLs pass through
untouched. It is a no-op when `VITE_API_BASE` is unset, so the same code serves
local development.

### Single-project layout

The root `vercel.json` builds both workspaces, outputs `frontend/dist`, and
rewrites:

| Source                | Destination       | Why                                               |
| --------------------- | ----------------- | ------------------------------------------------- |
| `/api/(.*)`           | `/api/[...path]`  | Every API route reaches the one serverless function |
| `/uploads/(.*)`       | `/api/[...path]`  | Uploaded images are served by the same function   |
| everything else       | `/index.html`     | Client-side routes have no file on disk            |

The last rewrite is what makes deep links such as `/profile`, `/admin` or
`/events/<id>` work: React Router paths are not files, so without it they 404.

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
| `npm run build`           | Production build of the Next.js app            |
| `npm start`               | Run the production build                       |
| `npm run lint`            | Lint the Next.js app                           |
| `npm run db:generate`     | Generate the Prisma client                     |
| `npm run db:migrate`      | Create a new migration                         |
| `npm run db:deploy`       | Apply migrations (used on Vercel)              |
| `npm run db:check`        | Preflight the migrations without applying them |
| `npm run db:seed`         | Seed default accounts and sample events        |
| `npm run db:studio`       | Open Prisma Studio                             |
| `npm run test:handler`    | Smoke-test the serverless entry (no DB needed) |
| `npm run android:assets`  | Generate icons and splash from `public/logo.png` |
| `npm run android:sync`    | Build the web config into the Android project  |
| `npm run android:open`    | Open `android/` in Android Studio              |
| `npm run android:run`     | Install and run on a connected device/emulator |
| `npm run android:build`   | Build an APK or AAB from the Android project   |

Uploaded images go to `backend/uploads` in development, served from `/uploads`.
When `BLOB_READ_WRITE_TOKEN` is set they are written to Vercel Blob instead and
the database stores the store's URL.

Both kinds of Blob store work. A **public** store is answered with a redirect
from `/uploads/<file>`, so browsers still fetch the bytes from the CDN without
invoking the serverless function. A **private** store refuses public uploads,
so the upload is retried with private access — the mode is remembered in a
setting — and `/uploads/<file>` then serves the bytes itself, which is the only
way a private store can be read at all. Either way `/uploads/<file>` is what
the browser requests, so one code path covers disk, public and private storage.
The `uploads` directory is excluded from version control.
