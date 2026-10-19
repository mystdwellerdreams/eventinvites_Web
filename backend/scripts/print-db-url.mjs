// Prints the PostgreSQL connection string to paste into Vercel.
//
// The value lives in the repository root .env.local, quoted, written by the
// Neon CLI. Reading it here avoids a hand-typed copy that drops a character or
// keeps the surrounding quotes, both of which Prisma rejects at build time.
//
// Usage: npm run db:url

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const candidates = [
  resolve(here, '../../.env.local'),
  resolve(here, '../.env.local'),
  resolve(process.cwd(), '.env.local'),
]

const file = candidates.find(existsSync)
if (!file) {
  console.error(
    '  No .env.local found. Run `neon link` or create it with a DATABASE_URL entry.',
  )
  process.exit(1)
}

const line = readFileSync(file, 'utf8')
  .split(/\r?\n/)
  .find((l) => l.startsWith('DATABASE_URL='))

if (!line) {
  console.error('  .env.local has no DATABASE_URL entry.')
  process.exit(1)
}

// "DATABASE_URL=" is 13 characters. Strip it, then the surrounding quotes.
const raw = line.slice('DATABASE_URL='.length).trim()
const value = raw.replace(/^["']/, '').replace(/["']$/, '').trim()

if (!/^postgres(ql)?:\/\//.test(value)) {
  console.error('  DATABASE_URL does not start with postgres:// — check the entry.')
  process.exit(1)
}

console.log(value)