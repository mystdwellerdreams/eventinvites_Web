# Deploying to Cloudflare

The application runs on one Cloudflare Worker. The Worker serves the API and
the web app from the same origin, and reaches the database through Hyperdrive
and the uploads through Neon Object Storage.

```
https://eventinvites.mystdwellerdreams.workers.dev
├── /api/*        the Express application
├── /uploads/*    the images the API serves
└── everything else   the web app, from the asset cache
```

Nothing is served from a server that renders pages, so the web app is a
single-page app: the router lives in the browser, and the Worker answers a
deep link such as `/events/key/abc` with the app itself.

## The parts

| Part | Where it lives | Notes |
| --- | --- | --- |
| API | Cloudflare Workers | The same Express application the Node deployment runs |
| Web app | Workers Static Assets | Built from the same `src/` as the Android app |
| Database | Neon PostgreSQL | Reached through Hyperdrive, which pools the connections |
| Uploads | Neon Object Storage | S3-compatible, in the bucket on the same Neon branch |
| Captcha | Cloudflare Turnstile | Already the provider |

## One-time setup

### 1. A Cloudflare account and a login

```bash
npx wrangler login
npx wrangler whoami
```

The Worker is named `eventinvites` in `wrangler.jsonc`, so it is published at
`<name>.<account>.workers.dev`.

### 2. The Hyperdrive connection

Hyperdrive keeps a warm connection pool next to the database, so a request
does not pay for a fresh TCP and TLS handshake every time. It is created
against the **direct** Neon connection string, not the pooled one:

```bash
npx wrangler hyperdrive create eventinvites \
  --connection-string="postgresql://USER:PASSWORD@ep-xxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require"
```

The command prints an identifier, which is what the deploy needs. There are
two ways to give it to it.

**Commit it.** The identifier is a resource id, not a secret, so it belongs in
the repository. Put it in `wrangler.jsonc`, where the binding still has its
placeholder:

```jsonc
"hyperdrive": [
  {
    "binding": "HYPERDRIVE",
    "id": "PASTE_THE_ID_HERE"
  }
]
```

**Or let the build set it.** Leave the placeholder and give the build the
identifier as a setting named `CLOUDFLARE_HYPERDRIVE_ID`. The deploy fills
the placeholder in before it uploads, so nothing has to be committed. On
Cloudflare's own build it is a build variable; on GitHub Actions it is a
repository variable or secret of the same name.

> **Without an identifier the deploy stops here**, with
> `Invalid hyperdrive database ID ... It must be a valid UUID`. That is the
> only thing between the repository and a running Worker.

**Or leave Hyperdrive out entirely.** Removing the `hyperdrive` block from
`wrangler.jsonc` makes the Worker reach the database with the
`DATABASE_URL` secret instead. It works, but every request opens its own
connection, so the answers are slow and the database sees more connections
than it should. It is worth doing only to ship something quickly.

The connection string holds a password, so it does not belong in the
repository: a local run reads it from the environment instead (see below).

### 3. The Worker's secrets

Every one of these is a secret, and each is set with `wrangler secret put`:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put REFRESH_SECRET
npx wrangler secret put FRONTEND_URL
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put BLOB_READ_WRITE_TOKEN
npx wrangler secret put BLOB_STORE_ID
npx wrangler secret put AWS_ENDPOINT_URL_S3
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
npx wrangler secret put AWS_REGION
npx wrangler secret put NEON_STORAGE_BUCKET
npx wrangler secret put NEON_STORAGE_ACCESS
```

`TURNSTILE_SECRET_KEY` is the Cloudflare Turnstile secret the API verifies a
challenge with. Without it the API accepts every challenge, so the check is
only real where it is set.

`BLOB_READ_WRITE_TOKEN` and `BLOB_STORE_ID` are the Vercel Blob store the
uploads live in, and they go together: the store id is what scopes the
store's access mode to this deployment, so that a changeover to another store
does not have the two deployments fighting over one remembered answer. See
[The upload store](DEPLOYMENT.md#the-upload-store).

`FRONTEND_URL` lists the origins that may call the API. The web app and the
API share an origin, so only the Android app needs one:

```
https://eventinvites.mystdwellerdreams.workers.dev,https://localhost
```

`https://localhost` is the origin of the Android WebView, which is where the
app's requests come from. Without it the app cannot reach the API, and the
health check says so.

If the captcha and the push notifications are in use, these two matter as
well:

```bash
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
npx wrangler secret put FCM_PROJECT_ID
```

### 4. The database

The migrations run against the **direct** connection string, because
Hyperdrive cannot run them:

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@ep-xxx.REGION.aws.neon.tech/neondb?sslmode=require&connect_timeout=15&pool_timeout=10"
npm run db:deploy
```

`connect_timeout` and `pool_timeout` matter: a database that has scaled to
zero has to wake up, and the handshake that follows can outlast a shorter
budget.

## Deploying

### With Cloudflare's own build

Cloudflare can build and deploy the Worker from the repository. Two settings
matter, in **Workers Builds**:

| Setting | Value | Why |
| ------- | ----- | --- |
| Build command | `npm run build` | Generates the Prisma client and builds the web app into `web/dist/`, which the Worker serves as its static assets |
| Deploy command | `npm run deploy:cloudflare` | Applies the migrations, then uploads the Worker and its assets |

The deploy command matters: a Worker that meets a schema it does not expect
answers every request with an error, so the migration goes first.

### From a terminal

```bash
npm run build            # the Prisma client and the web assets
npm run deploy:cloudflare   # the migrations, then the Worker
```

### With GitHub Actions

The workflow in `.github/workflows/deploy-worker.yml` does the same on every
push to `main`: it type-checks, builds, applies the migrations and deploys.
It needs four repository secrets:

| Secret | What it is |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | An API token with the Workers and Hyperdrive permissions |
| `CLOUDFLARE_ACCOUNT_ID` | The account the Worker is published to |
| `DATABASE_URL` | The direct Neon connection string, for the migrations |
| `VITE_TURNSTILE_SITE_KEY` | The site's captcha key, baked into the web bundle |

The Worker's own secrets are set once with `wrangler secret put` and are not
read by the workflow.

## Working on it locally

```bash
npm run worker:dev
```

The local server is on http://127.0.0.1:8787 and serves the web app, the API
and the uploads, the same way the deployed Worker does.

It reads:

- `.dev.vars` for the secrets, written from `.env.local` by
  `npm run cf:dev-vars`. The file is gitignored.
- `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` for the local
  database, set from `.env.local` by `npm run worker:dev`.

A local run is slower than production, because there is no Hyperdrive in the
loop: every request opens its own connection to Neon, and the database is in
`ap-southeast-1`. In production Hyperdrive keeps the connections warm.

To check a local Worker the way the app uses it:

```bash
npm run worker:check
```

## Notes

- **The Workers Free plan is not enough.** It allows ten milliseconds of CPU
  per request, and hashing a password with bcrypt takes longer than that. The
  paid plan starts at five dollars a month and includes ten million requests.
- **A failure to reach the database is not a deployment failure.** The health
  check reports which layer is down, and says so in the log. A database that
  has scaled to zero answers slowly rather than not at all.
- **The uploads are read through the API.** The bucket is private, so the
  Worker reads the bytes with its credentials and serves them. Making the
  bucket public lets the browser fetch the images straight from the store
  instead; that is a change to the bucket, not to the code.
- **There are two generated Prisma clients, and the Worker picks the right
  one.** The Workers runtime only allows WebAssembly it was given as a
  module, so the query compiler has to be a module beside the code; in Node
  it is bytes the client compiles at startup, which the runtime forbids. The
  schema generates both, and `wrangler.jsonc` aliases the one the Worker uses.
  Regenerating the client produces both again.

