# Deploying

Four parts, four hosts, and none of them overlapping with the last one:

```
GitHub Pages          the single-page app
Vercel                the API
Neon                  the database and the uploads
GitHub Actions        the builds and the deploys
```

The app and the API are on different hosts, so the browser's calls are
cross-origin: the API answers with CORS headers for the site's origin, and
the session is a cookie marked `SameSite=None`. The Android app is not
affected by that — it authenticates with a bearer token, never with a cookie.

| Part | Where | Cost |
| --- | --- | --- |
| Web app | GitHub Pages | free, or $4/month for a private source repository |
| API | Vercel Hobby | free, for non-commercial use |
| Database | Neon | free |
| Uploads | Vercel Blob | a small free allowance |
| Builds | GitHub Actions | free, 2,000 minutes a month |

---

## 1. The database and the uploads

Both are already in place on the same Neon branch.

- The database is the `production` branch in `ap-southeast-1`.
- The uploads live in the Vercel Blob store, and the token that identifies it
  is the only thing the API needs.

The connection strings are in the repository's `.env.local` (which is
gitignored) and are also set on the Vercel project.

```bash
npm run db:check     # the migrations that are pending, if any
npm run db:deploy    # apply them
```

The migrations run against the **direct** connection string, never a pooled
one.

## 2. The API on Vercel

### The project

Import the repository into Vercel. The settings are:

| Setting | Value |
| --- | --- |
| Root Directory | the repository root |
| Framework Preset | Next.js (from `vercel.json`) |
| Build Command | from `vercel.json`: generate, migrate, `next build` |
| Node | 22 or later |

The build command applies the migrations, so the API never meets a schema it
does not expect. It needs `DATABASE_URL` to be set before the build runs.

### The environment variables

Set these on the project, for **Production and Preview** alike — the build
applies migrations, so a preview build needs them too.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | the pooled Neon connection string |
| `DIRECT_DATABASE_URL` | no | the direct connection, used for the migrations |
| `JWT_SECRET` | yes | signs access tokens |
| `REFRESH_SECRET` | yes | signs refresh tokens |
| `BLOB_READ_WRITE_TOKEN` | yes | the Vercel Blob store the uploads live in |
| `BLOB_STORE_ID` | no | identifies the store, for reference |
| `FRONTEND_URL` | yes | the origins allowed to call the API |
| `TURNSTILE_SECRET_KEY` | no | enables the real captcha check |
| `FCM_SERVICE_ACCOUNT_JSON` | no | enables push to the Android app — see [Push notifications](#push-notifications) |
| `CROSS_SITE_AUTH` | no | `false` to keep the cookies `SameSite=Lax` |

The uploads go to **Vercel Blob**. The token identifies the store, so it is
all the API needs; without it the uploads fall back to a local disk, which a
serverless host discards between requests.

An S3-compatible store — Neon Object Storage among them — can be used
instead by setting the `AWS_*` variables and leaving
`BLOB_READ_WRITE_TOKEN` unset. `STORAGE_BACKEND` picks one explicitly when
more than one is configured.

`FRONTEND_URL` lists the origins that may call the API:

```
https://<your-site>.github.io,https://localhost
```

The first is the web app. The second is the Android app: its WebView's origin
is `https://localhost`, and because it sends an `Authorization` header, every
request is preflighted and the origin has to be allowed.

### The connection string

Use the **pooled** endpoint for the runtime, and give it the timeouts a cold
database needs:

```
postgresql://…@ep-<id>-pooler.<region>.aws.neon.tech/neondb?sslmode=require&connect_timeout=15&pool_timeout=10
```

A managed database scales to zero, and the first connection has to wake it.
Prisma's default of five seconds is often not enough, and the first request
after an idle period fails while the ones after it succeed. The migration
script adds the timeouts if they are missing, and so does the API at runtime,
but it is better to set them on the variable itself.

Set `DIRECT_DATABASE_URL` to the **direct** endpoint as well:

```
postgresql://…@ep-<id>.<region>.aws.neon.tech/neondb?sslmode=require&connect_timeout=15&pool_timeout=10
```

The migrations use it when it is set. A migration wants a connection of its
own: it holds a Postgres advisory lock and runs DDL in a transaction, and the
pooled endpoint shares its sessions.

**The direct endpoint is not reachable from everywhere.** Neon serves it over
IPv6, and a build container with no IPv6 route cannot get to it — even though
a TLS handshake still answers, so a reachability probe does not catch it. The
migration script therefore falls back to the pooled endpoint when the
migration reports that the database could not be reached, and says so. If the
build keeps failing with `P1001`, removing `DIRECT_DATABASE_URL` is the
quickest way to confirm it.

### Deployments and migrations

The build command applies the migrations, and **only on a production
deployment**. A preview shares the database with production, and Prisma waits
ten seconds for the migration lock before giving up — so two deployments
overlapping leave one of them failing with `P1002`. Previews therefore leave
the database alone. Set `DB_MIGRATE_ON_PREVIEW=1` if a preview ever does need
to migrate.

If a deployment still loses the race, the script waits and tries again:
`DB_MIGRATE_ATTEMPTS` (3) and `DB_MIGRATE_RETRY_MS` (15000) control that.

### The Vercel plan

The Hobby plan is free, but it "restricts users to non-commercial, personal
use only" — asking for donations does not count as commercial, taking
payments does. A commercial app needs Pro at $20/month.

Hobby includes a million function invocations a month. The app polls
`/api/health` every twenty seconds while it is in the foreground, which is
about 130,000 invocations a month for each active client — so roughly seven
concurrent users before the allowance is spent. `HEALTHY_INTERVAL_MS` in
`src/hooks/useConnectivity.ts` controls that interval.

## 3. The web app on GitHub Pages

### The repository

GitHub Pages is free for **public** repositories. For a private one it needs
GitHub Pro. Two ways to keep the source private and the site free:

- Publish the built site from a separate **public** repository (for example
  `mystdwellerdreams.github.io`). The published artefact is the same
  JavaScript anyone using the app already downloads.
- Or make the source repository public. The secrets are gitignored, so
  nothing leaks, but the code does.

Whichever repository serves the site has **Settings → Pages → Build and
deployment → Source** set to **GitHub Actions**, for the workflow to be
allowed to publish.

### The repository variables

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE` | the API's origin, for example `https://eventinvites-api.vercel.app/api`. It has to be absolute: the app and the API are on different hosts |
| `VITE_TURNSTILE_SITE_KEY` | the captcha's site key, baked into the bundle |
| `PAGES_BASE` | where the site is published. `/` for a user site, `/<repository>/` for a project site |

### Deep links

GitHub Pages has no single-page fallback, so it would answer a deep link such
as `/events/key/abc` with its own error page. The build writes a copy of the
app as `404.html`, which GitHub Pages serves for any path it cannot find. The
browser stays on the URL that was asked for, and the router — which reads the
path from the address — routes it as it routes any other path.

To see it behave that way locally:

```bash
npm run web:build
npm run web:preview   # serves web/dist the way GitHub Pages does
npm run web:check     # checks that the deep links reach the app
```

## 4. The Android app

The app is a Capacitor shell with the web app bundled inside it. It does not
load the site from GitHub Pages, and it never sees the Pages routing or the
cross-site cookies — it talks to the API directly, with a bearer token.

### The API it points at

```bash
VITE_API_BASE=https://eventinvites-api.vercel.app/api npm run app:build
npm run android:sync
```

### The release signing key

The key is not in the repository, and an APK signed with it can be updated by
whoever holds the key, so it stays with its owner.
```bash
keytool -genkeypair -v -keystore android/event-invites-release.jks \
  -keyalg RSA -keysize 2048 -validity 10000 -alias eventinvites
```

Then `android/keystore.properties`, which is gitignored:

```properties
storeFile=event-invites-release.jks
storePassword=...
keyAlias=eventinvites
keyPassword=...
```

The build reads it, or the environment variables
`ANDROID_KEYSTORE_FILE`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and
`ANDROID_KEY_PASSWORD`, which is how the workflow signs an APK it has no key
store for. Without either, the release build is left unsigned — Gradle
produces an APK that cannot be installed, which is a clearer failure than one
signed with the debug key.

### The version

`android/app/build.gradle` carries the version the app reports to the server
and to Google Play. A new build has to carry a higher `versionCode` than the
one installed, or it will not install over it:

```gradle
versionCode 2
versionName "1.0.0-beta.1"
```

### The build

```bash
npm run app:build        # bundle the app
npm run android:sync     # copy it into the Android project
npm run android:apk      # build the signed APK
```

The APK lands in `android/app/build/outputs/apk/release/app-release.apk`.

## 5. Push notifications

Two things have to be in place, and they are different halves of the same
chain.

**The API signs the message.** It needs a Firebase service account, which
Firebase issues as a JSON document. The API reads it from
`FCM_SERVICE_ACCOUNT_JSON` and accepts three forms, because an environment
variable holds one line and a document copied out of a console rarely fits:

| Form | When to use it |
| --- | --- |
| the raw JSON on one line | a deployment's environment variable |
| base64 of the same document | a `.env` file, whose parser cannot carry a document with quotes in it |
| a document pasted by hand | neither of the above — the API repairs it |

```bash
# A deployment: the raw document.
npx vercel env add FCM_SERVICE_ACCOUNT_JSON production

# A .env file: the base64 copy.
npm run push:fix --workspace=backend
```

**The app asks for a token.** The APK carries the app's own Firebase
configuration, which names the project, the sender and the API key. It is not
secret, but it is not in the repository either, so the build writes it from
the `FCM_GOOGLE_SERVICES_JSON` secret.

**Checking it.** The app registers its device against the signed-in account, so
a device that has never been opened against this API has no token and no push
can reach it. The API says so:

```bash
curl -X POST https://<your-api>/api/devices/test -H 'cookie: <a session cookie>'
# {"devices":1,"configured":true}
```

`configured: true` means the service account was read and the chain is whole;
`devices: 0` means no phone has registered yet.

The whole chain can be checked without a phone:

```bash
npm run push:check --workspace=backend     # the account, and a token from Google
npm run check:deployed --workspace=backend # the uploads, the device, and the push test
```

## 6. The workflows

| Workflow | When | What it does |
| --- | --- | --- |
| `deploy-web.yml` | every push to `main` | builds the web app and publishes it to Pages |
| `deploy-api.yml` | every push to `main` | deploys the API to Vercel |
| `build-android.yml` | a `v*` tag, or by hand | builds the signed APK and attaches it to a release |

### The secrets and variables the workflows need

**Secrets** (Settings → Secrets and variables → Actions):

| Secret | Used by |
| --- | --- |
| `VERCEL_TOKEN` | the API deploy |
| `VERCEL_PROJECT_ID` | the API deploy |
| `VERCEL_ORG_ID` | the API deploy |
| `ANDROID_KEYSTORE_BASE64` | the Android build |
| `ANDROID_KEYSTORE_PASSWORD` | the Android build |
| `ANDROID_KEY_ALIAS` | the Android build |
| `ANDROID_KEY_PASSWORD` | the Android build |

**Variables** — the same table as above, plus the Pages ones. They are not
secret: the captcha's site key is public by design, and the API's origin is
in the bundle either way.

The signing key is stored base64-encoded:

```bash
base64 -w0 android/event-invites-release.jks
```

## 7. Checking a deployment

```bash
curl https://<your-api>.vercel.app/api/health
```

A healthy deployment answers with:

```json
{
  "status": "ok",
  "runtime": "serverless",
  "storage": "blob",
  "database": "ok",
  "storageReady": "ok",
  "corsOrigins": ["https://<your-site>.github.io", "https://localhost"],
  "crossSiteCookies": true
}
```

Check three things: `database` and `storageReady` are `ok`, and `corsOrigins`
lists **both** the site and `https://localhost`.

### A value copied with its quotes

The local `.env.local` quotes its values, because that is how `.env` files are
written. **A deployment's environment variable takes the value itself**, so a
value copied straight out of the local file arrives wrapped in quotes — and a
string that begins with a quote is not a URL and not a key.

The quotes are stripped wherever the API reads the environment, so a value
pasted from the local files works, but it is worth fixing: the API says so at
startup, in a line beginning `[config]`.

What each symptom looks like:

| Value | Symptom |
| --- | --- |
| `DATABASE_URL` | the build stops with `DATABASE_URL is not a valid URL` |
| `BLOB_READ_WRITE_TOKEN` | the upload store does not answer, and the health check says `storageReady: "down"` |
| `FRONTEND_URL` | the origins are wrong, so every request is refused by the CORS check |

### When the storage is down

`storageReady: "down"` means the upload store did not answer, and the health
response cannot say why. The reason is in the **function's log** in the
Vercel dashboard, under the message `The upload store did not answer:`. The
API also says at startup what is wrong with the configuration, in lines
beginning `[config]`.

The usual causes:

- **A value copied with its quotes.** See [above](#a-value-copied-with-its-quotes).
- **A variable that was never set.** `BLOB_READ_WRITE_TOKEN` has to be there.
- **The wrong token.** It identifies one store, and it is shown only once, so
  a store that was recreated has a new one. The startup check prints a
  fingerprint of it, which is enough to tell two apart without writing the
  token down.

To see the same diagnosis without a deployment:

```bash
npm run storage:check --workspace=backend    # writes, reads and removes a file
npm run storage:describe --workspace=backend  # what the store answers, and how
```

And to check a deployment the way the app uses it — the captcha, a sign-in, an
upload and the image coming back:

```bash
npm run check:deployed --workspace=backend
```

## 8. When something fails

| Symptom | Cause | Fix |
| --- | --- | --- |
| The site shows the Pages error page on a deep link | `404.html` was not published | check that the build wrote it, and that Pages serves the branch the workflow published |
| The build fails with `P1002` | another deployment held the migration lock | the script retries; if it keeps failing, a migration is running by hand |
| The build fails with `P1002` on every preview | a preview was told to migrate | unset `DB_MIGRATE_ON_PREVIEW` |
| The site's requests fail in the console | the origin is not allowed | add it to `FRONTEND_URL` |
| The web app does not stay signed in in Safari | Safari blocks third-party cookies | set `CROSS_SITE_AUTH` to `false` and put the site and the API behind one hostname, or give the web a token-based session |
| `503` from `/api/health` with `database: down` | the API cannot reach the database | check `DATABASE_URL` on the Vercel project, and that it has the timeouts |
| `503` from `/api/health` with `storageReady: down` | the upload store did not answer | the reason is in the function's log; see [When the storage is down](#when-the-storage-is-down) |
| The first request after an idle period fails | the database was scaling to zero | add `connect_timeout=15&pool_timeout=10` to `DATABASE_URL` |
| The APK will not install over an older one | the `versionCode` did not go up | raise it in `android/app/build.gradle` |
| The APK is unsigned | no signing key was found | provide `keystore.properties` or the `ANDROID_KEYSTORE_*` variables |

## The other target

The Cloudflare Worker deployment is still in the repository, and still works:
`worker/` holds the entry, `wrangler.jsonc` the configuration, and
`npm run deploy:cloudflare` deploys it. It serves the API and the web app
from one origin, which avoids the cross-site cookies entirely, but it costs
$5 a month for the paid plan — the free plan's ten milliseconds of CPU per
request is less than the password hashing alone takes. See
[docs/CLOUDFLARE.md](CLOUDFLARE.md).
