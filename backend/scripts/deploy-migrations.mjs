// Runs `prisma migrate deploy` for the Vercel build, but only against a
// database the environment actually points at.
//
// Without this guard the failure is silent and misleading: Prisma falls back to
// the repository's backend/.env and tries localhost, reporting
//   P1001: Can't reach database server at `localhost:5432`
// which says nothing about the real problem, that DATABASE_URL is unset in the
// build environment.
import { spawn } from 'node:child_process'
import net from 'node:net'
import tls from 'node:tls'
import { config as loadEnv } from 'dotenv'

// Local secrets live in the repository root .env.local, never inside the
// deployed tree. On Vercel this finds nothing and the project variables apply.
loadEnv({ path: ['../.env.local', '.env.local'], quiet: true })

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']

function fail(message, detail) {
  console.error(`\n  Migration preflight failed: ${message}\n`)
  if (detail) console.error(detail)
  process.exit(1)
}

function warn(message, detail) {
  console.warn(`\n  Warning: ${message}\n`)
  if (detail) console.warn(detail)
}

const raw = process.env.DATABASE_URL

if (!raw || !raw.trim()) {
  fail(
    'DATABASE_URL is not set in this build environment.',
    [
      '  In Vercel: Project Settings -> Environment Variables, add DATABASE_URL',
      '  for every environment you deploy (Production and Preview both run this',
      '  build command). Paste the connection string from your Postgres provider',
      '  (Neon, Supabase, Vercel Postgres) with the ?schema=public parameter kept.',
      '',
      '  It must be reachable from Vercel build containers as well as at runtime.',
    ].join('\n')
  )
}

let parsed
try {
  parsed = new URL(raw)
} catch {
  fail('DATABASE_URL is not a valid URL.', `  Got: ${raw}`)
}

if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
  fail(
    `DATABASE_URL uses the "${parsed.protocol}" scheme, but Prisma needs a Postgres connection string.`,
    [
      '  This usually means the wrong URL was copied. In your database provider',
      '  dashboard, look for a **connection string** / **direct URL**, not the',
      '  project URL, console URL or API endpoint.',
      '',
      '  A usable value looks like:',
      '    postgresql://USER:PASSWORD@HOST/DATABASE?schema=public',
      '',
      '  Neon:   the "Pooled connection" or "Direct connection" string',
      '  Supabase: Project Settings -> Database -> Connection string (URI)',
      '  Vercel Postgres / Neon: the `postgres://` URL shown after creating the store',
      '',
      `  Currently set to: ${raw.slice(0, 60)}${raw.length > 60 ? '…' : ''}`,
    ].join('\n')
  )
}

// Vercel sets VERCEL=1 in builds; CI is a useful fallback for other hosts.
// Local development is allowed to target a local database, so the localhost
// rule only applies where it is definitely wrong.
const inCloudBuild = Boolean(process.env.VERCEL || process.env.CI)

// A *.vercel.app host is a frontend deployment, never a database. Reaching
// one on :5432 hangs until the build times out, so catch it here instead.
if (/(^|\.)vercel\.app$/i.test(parsed.hostname)) {
  fail(
    `DATABASE_URL points at ${parsed.hostname}, which is a Vercel frontend domain, not a database.`,
    [
      '  It looks like the frontend project\'s domain was pasted into the',
      '  connection string.',
      '',
      '  Use the database host from your Postgres provider instead:',
      '    Neon   ep-<id>-<pooler|direct>.<region>.aws.neon.tech',
      '',
      '  To copy the correct value out of this checkout, run:',
      '    node -e "console.log(require(\'fs\').readFileSync(\'.env.local\',\'utf8\').split(String.fromCharCode(10)).find(l=>l.startsWith(\'DATABASE_URL=\')).slice(15))"',
    ].join('\n')
  )
}

if (LOCAL_HOSTS.includes(parsed.hostname) && inCloudBuild) {
  fail(
    `DATABASE_URL points at ${parsed.hostname}, which a cloud build cannot reach.`,
    [
      '  This almost always means the build fell back to the repository copy of',
      '  backend/.env instead of the variable configured in Vercel.',
      '',
      '  Set DATABASE_URL in Project Settings -> Environment Variables, then',
      '  redeploy. If you previously deployed with a stale copy of the project,',
      '  remove the deployment and deploy again from a clean checkout.',
    ].join('\n')
  )
}

console.log(
  `  DATABASE_URL ok -> ${parsed.hostname}:${parsed.port || 5432}/${parsed.pathname.replace(/^\//, '')}`
)

// A managed database scales to zero when idle, and the first connection has
// to wake it — which takes about as long as Prisma's default 5s connect
// timeout, so the wake loses the race and the first request of a cold period
// fails. Widening the timeouts costs nothing when the endpoint is warm and
// removes that race entirely.
const missingTimeouts = []
if (!parsed.searchParams.has('connect_timeout')) missingTimeouts.push('connect_timeout')
if (!parsed.searchParams.has('pool_timeout')) missingTimeouts.push('pool_timeout')

if (missingTimeouts.length > 0) {
  warn(
    `DATABASE_URL is missing ${missingTimeouts.join(' and ')}.`,
    [
      '  A sleeping database needs longer than Prisma\'s 5s default to answer,',
      '  so the first connection after an idle period fails while later ones',
      '  succeed. Add both parameters to the connection string:',
      '',
      '    ...?sslmode=require&connect_timeout=15&pool_timeout=10',
      '',
      '  Set the same value in Vercel: Project Settings -> Environment Variables.',
    ].join('\n')
  )
}

// A managed database scales to zero when idle, and the first connection has to
// wake it. Probing first turns that into a clear message instead of a build
// that appears to hang on the datasource line.
const PROBE_TIMEOUT_MS = Number(process.env.DB_PROBE_TIMEOUT_MS ?? 25000)
const port = Number(parsed.port || 5432)

const reachable = await new Promise((resolve) => {
  const socket = net.connect({ host: parsed.hostname, port })
  let settled = false
  const finish = (ok, why) => {
    if (settled) return
    settled = true
    try {
      socket.destroy()
    } catch {
      // Already closed.
    }
    resolve({ ok, why })
  }
  socket.setTimeout(PROBE_TIMEOUT_MS)
  socket.on('timeout', () => finish(false, 'timed out'))
  socket.on('error', (err) => finish(false, err.code || err.message))
  socket.on('secureConnect', () => finish(true, 'tls'))
  socket.on('connect', () => {
    // Managed Postgres expects TLS; upgrade to confirm the handshake works.
    const secured = tls.connect(
      { socket, servername: parsed.hostname, rejectUnauthorized: false },
      () => finish(true, 'tls')
    )
    secured.on('error', (err) => finish(false, `tls: ${err.code || err.message}`))
    secured.setTimeout(PROBE_TIMEOUT_MS)
  })
})

if (!reachable.ok) {
  const timedOut = reachable.why === 'timed out'
  const hint = timedOut
    ? [
        '  The host answered no data within the probe window. Managed PostgreSQL',
        '  (Vercel Postgres, Neon, Supabase) suspends when idle and the first',
        '  connection wakes it, which can outlast the build.',
      ]
    : [
        '  The connection was refused or the TLS handshake failed.',
        '  A suspended database usually shows up as a timeout, so this points',
        '  at the host, port or sslmode setting.',
      ]

  fail(`cannot reach the database at ${parsed.hostname}:${port} (${reachable.why}).`, [
    ...hint,
    '',
    `  Probe budget was ${PROBE_TIMEOUT_MS}ms. To resolve:`,
    '   1. Run the same check locally and iterate fast:',
    '        npm run db:check',
    '   2. Open the database in your provider dashboard so it is awake.',
    '   3. Copy the CONNECTION STRING, not the project or console URL. A',
    '      host that only answers on 443 is a web project, not a database.',
    '   4. Use the pooled endpoint and include sslmode=require.',
    '   5. If you hit a timeout in CI, raise DB_PROBE_TIMEOUT_MS.',
    '',
    '  The stored connection string is masked here, so confirm the host and',
    '  database name against your dashboard rather than from this message.',
  ].join('\n'))
}

// `--check` validates the connection and exits without applying migrations, so
// the same diagnosis can be run locally in seconds instead of a build.
const checkOnly = process.argv.includes('--check') || process.env.DB_CHECK_ONLY === '1'

console.log('  database reachable (TLS ok)')

if (checkOnly) {
  console.log('  --check passed; migrations were not applied.')
  process.exit(0)
}

// A single command string avoids Node's deprecation warning about passing an
// argument array with shell enabled, which also concatenates args unescaped.
const child = spawn('npx prisma migrate deploy', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: raw },
  shell: true,
})

child.on('error', (err) => {
  console.error(`  Could not start prisma: ${err.message}`)
  process.exit(1)
})
child.on('exit', (code) => process.exit(code ?? 1))