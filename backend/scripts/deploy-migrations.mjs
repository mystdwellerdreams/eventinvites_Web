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

/**
 * A value as the deployment gave it.
 *
 * A connection string copied out of a .env file arrives with its quotes still
 * around, because that is how the local files are written — and a string that
 * begins with a quote is not a URL at all. The quotes are taken off here, so
 * a value pasted from the local files works wherever it is set.
 */
function unquote(value) {
  const trimmed = value.trim()
  if (trimmed.length >= 2 && /^["'].*["']$/.test(trimmed)) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

function fail(message, detail) {
  console.error(`\n  Migration preflight failed: ${message}\n`)
  if (detail) console.error(detail)
  process.exit(1)
}

function warn(message, detail) {
  console.warn(`\n  Warning: ${message}\n`)
  if (detail) console.warn(detail)
}

const raw = process.env.DATABASE_URL ? unquote(process.env.DATABASE_URL) : undefined

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
      '  The migration below is given them either way, but the runtime reads',
      '  DATABASE_URL directly, so the deployed API needs them too. Set the',
      '  same value in Vercel: Project Settings -> Environment Variables.',
      '',
      '  A DIRECT_DATABASE_URL, when set, is used for the migration instead:',
      '  a migration wants a connection of its own, and the pooled endpoint',
      '  shares its sessions.',
    ].join('\n')
  )
}

// A managed database scales to zero when idle, and the first connection has to
// wake it. Probing first turns that into a clear message instead of a build
// that appears to hang on the datasource line.
const PROBE_TIMEOUT_MS = Number(process.env.DB_PROBE_TIMEOUT_MS ?? 25000)

/** Opens a TCP connection and upgrades it to TLS, to see whether a host answers. */
function probe(url) {
  const host = new URL(url).hostname
  const port = Number(new URL(url).port || 5432)
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (ok, why) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        // Already closed.
      }
      resolve({ ok, why, host, port })
    }
    socket.setTimeout(PROBE_TIMEOUT_MS)
    socket.on('timeout', () => finish(false, 'timed out'))
    socket.on('error', (err) => finish(false, err.code || err.message))
    socket.on('secureConnect', () => finish(true, 'tls'))
    socket.on('connect', () => {
      // Managed Postgres expects TLS; upgrade to confirm the handshake works.
      const secured = tls.connect(
        { socket, servername: host, rejectUnauthorized: false },
        () => finish(true, 'tls')
      )
      secured.on('error', (err) => finish(false, `tls: ${err.code || err.message}`))
      secured.setTimeout(PROBE_TIMEOUT_MS)
    })
  })
}

/**
 * The connection strings to try, in order.
 *
 * A migration wants a connection of its own, so a direct endpoint is
 * preferred: the pooled one shares its sessions. But the direct endpoint is
 * not reachable from everywhere — Neon serves it over IPv6, and a build
 * container with no IPv6 route cannot get to it — so the pooled endpoint is
 * the fallback. It gives a session of its own in session mode, which is
 * enough.
 */
const direct = process.env.DIRECT_DATABASE_URL ? unquote(process.env.DIRECT_DATABASE_URL) : ''
const candidates = [...new Set([direct, raw].filter(Boolean))]

let reachable = null
let target = raw
for (const candidate of candidates) {
  const attempt = await probe(candidate)
  if (attempt.ok) {
    reachable = attempt
    target = candidate
    break
  }
  if (candidate !== raw) {
    warn(
      `the direct database at ${attempt.host} did not answer (${attempt.why}), so the pooled one is used instead.`,
      [
        '  The direct endpoint is not reachable from everywhere, and the',
        '  migrations work on the pooled endpoint in session mode, which gives',
        '  a session of its own.',
        '',
        '  To use the direct one, make sure the build host can reach it.',
      ].join('\n')
    )
  } else {
    reachable = attempt
  }
}

const { port } = reachable

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

console.log(
  `  database reachable (TLS ok) -> ${new URL(target).hostname}:${new URL(target).port || 5432}`
)

if (checkOnly) {
  console.log('  --check passed; migrations were not applied.')
  process.exit(0)
}

// A preview deployment must not change the database.
//
// It shares it with production, and Prisma holds a Postgres advisory lock for
// the whole migration run. Every deployment applies migrations at build time,
// so a preview and a production build that overlap leave one of them waiting
// for a lock that Prisma gives up on after ten seconds.
const isPreview = process.env.VERCEL_ENV === 'preview'
if (isPreview && process.env.DB_MIGRATE_ON_PREVIEW !== '1') {
  console.log(
    '  preview deployment: the migrations are not applied, so the database is\n' +
      '  left as it is. Set DB_MIGRATE_ON_PREVIEW=1 to apply them anyway.'
  )
  process.exit(0)
}

/**
 * The timeouts a cold database needs.
 *
 * A managed database scales to zero, and the first connection has to wake it.
 * Prisma's defaults are too short for that, so the migration is given the
 * longer ones whether or not the configured string carries them. The runtime
 * reads DATABASE_URL directly, so it still needs them there.
 */
function withMigrationTimeouts(url) {
  const [base, query = ''] = url.split('?')
  const params = new URLSearchParams(query)
  if (!params.has('connect_timeout')) params.set('connect_timeout', '15')
  if (!params.has('pool_timeout')) params.set('pool_timeout', '10')
  return `${base}?${params.toString()}`
}

const MIGRATE_ATTEMPTS = Number(process.env.DB_MIGRATE_ATTEMPTS ?? 3)
const MIGRATE_RETRY_MS = Number(process.env.DB_MIGRATE_RETRY_MS ?? 15000)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Runs the migration, and says what went wrong. */
function runMigrate(url) {
  return new Promise((resolve) => {
    // A single command string avoids Node's deprecation warning about passing an
    // argument array with shell enabled, which also concatenates args unescaped.
    const child = spawn('npx prisma migrate deploy', {
      stdio: ['inherit', 'inherit', 'pipe'],
      env: { ...process.env, DATABASE_URL: url },
      shell: true,
    })

    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('error', (err) => {
      console.error(`  Could not start prisma: ${err.message}`)
      process.exit(1)
    })
    child.on('exit', (code) => {
      resolve({
        code: code ?? 1,
        lockContended: /P1002|advisory lock/i.test(stderr),
        // The database could not be reached at all, rather than refusing
        // what it was asked to do.
        unreachable: /P1001|Can't reach database server/i.test(stderr),
      })
    })
  })
}

// The endpoint to try next, and the one to fall back to.
const preferred = withMigrationTimeouts(target)
const fallback = withMigrationTimeouts(raw)
let current = preferred
let usedFallback = false

for (let attempt = 1; attempt <= MIGRATE_ATTEMPTS; attempt++) {
  const { code, lockContended, unreachable } = await runMigrate(current)

  if (code === 0) {
    process.exit(0)
  }

  // A direct endpoint that the build host cannot reach is the usual reason
  // for this. The pooled endpoint gives a session of its own in session mode,
  // which is enough for a migration, so the run carries on with it.
  if (unreachable && current !== fallback) {
    warn(
      'the database could not be reached, so the pooled endpoint is used instead.',
      [
        '  The direct endpoint is not reachable from every host — Neon serves',
        '  it over IPv6, and a build container with no IPv6 route cannot get',
        '  to it — even though a TLS handshake still answers.',
        '',
        '  The pooled endpoint answers over IPv4 and gives a session of its own,',
        '  which is what a migration needs.',
        '',
        '  To use the direct one, make sure the build host can reach it.',
      ].join('\n')
    )
    current = fallback
    usedFallback = true
    continue
  }

  if (lockContended && attempt < MIGRATE_ATTEMPTS) {
    warn(
      `another deployment is holding the migration lock (attempt ${attempt} of ${MIGRATE_ATTEMPTS}).`,
      [
        '  Prisma waits ten seconds for the lock and then gives up. Something',
        '  else is migrating right now — a preview build, a production build,',
        '  or a migration run by hand.',
        '',
        `  Waiting ${Math.round(MIGRATE_RETRY_MS / 1000)}s and trying again.`,
        '  Set DB_MIGRATE_ATTEMPTS and DB_MIGRATE_RETRY_MS to change that.',
      ].join('\n')
    )
    await sleep(MIGRATE_RETRY_MS)
    continue
  }

  if (usedFallback && unreachable) {
    fail('the database could not be reached on either endpoint.', [
      `    direct:  ${new URL(preferred).hostname}`,
      `    pooled:  ${new URL(fallback).hostname}`,
      '',
      '  Both were tried. Check that the database is running and that the',
      '  connection string points at it.',
    ].join('\n'))
  }

  process.exit(code)
}