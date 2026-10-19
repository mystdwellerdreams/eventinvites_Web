import dotenv from 'dotenv'
import { defineConfig } from 'prisma/config'

/**
 * Prisma CLI configuration.
 *
 * The connection URL moved out of the schema in Prisma 7, so the CLI and the
 * migration script read it from here. The same two files the app reads are
 * loaded, in the same order, so the CLI and the running server always agree
 * on which database they mean.
 */
dotenv.config({ path: ['../.env.local', '.env.local'], quiet: true })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Left undefined when it is not set, so `prisma generate` works without a
    // database. The commands that need one fail with a clear error instead.
    url: process.env.DATABASE_URL,
  },
})
