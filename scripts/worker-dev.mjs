import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

/**
 * Runs `wrangler dev` with the database's local connection string.
 *
 * Wrangler needs a local connection string to stand in for Hyperdrive when
 * it runs on this machine. It holds a password, so it does not belong in
 * wrangler.jsonc; Wrangler reads it from this environment variable instead,
 * and this script fills it in from the repository's .env.local.
 */
const source = readFileSync('.env.local', 'utf8')
const values = new Map()
for (const line of source.split(/\r?\n/)) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (!match) continue
  values.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''))
}

const connectionString = values.get('DIRECT_DATABASE_URL') ?? values.get('DATABASE_URL')
if (!connectionString) {
  console.error(
    'No DATABASE_URL in .env.local, so there is nothing for the local Worker to\n' +
      'connect to. Add it there; the file is gitignored.'
  )
  process.exit(1)
}

const child = spawn(
  'npx',
  ['wrangler', 'dev', ...process.argv.slice(2)],
  {
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: connectionString,
    },
  }
)

child.on('exit', (code) => process.exit(code ?? 0))
