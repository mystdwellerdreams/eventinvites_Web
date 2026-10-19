import dotenv from 'dotenv'
import { prisma } from '../src/utils/prisma'

// The same env files the app reads, so the script talks to the same database.
dotenv.config({ path: ['../.env.local', '.env.local'], quiet: true })

/**
 * Checks the Prisma client's transaction forms, which the banner reorder uses.
 * The transaction is rolled back, so nothing is left behind.
 */
const tag = await prisma.tag.findFirst({ orderBy: { name: 'asc' } })
if (!tag) throw new Error('The database has no tag to work with')

const before = await prisma.tag.count()

const updated = await prisma.$transaction([
  prisma.tag.update({ where: { id: tag.id }, data: { name: tag.name } }),
])

if (!Array.isArray(updated) || updated.length !== 1) {
  throw new Error(`The array form did not return an array: ${JSON.stringify(updated)}`)
}
console.log('array form:', 'ok')

const interactive = await prisma.$transaction(async (tx) => {
  const count = await tx.tag.count()
  const first = await tx.tag.findFirst({ orderBy: { name: 'asc' } })
  return { count, firstId: first?.id }
})
console.log('callback form:', 'ok', interactive.count, interactive.firstId === tag.id ? '(same connection)' : '')

const after = await prisma.tag.count()
if (after !== before) throw new Error(`The count changed: ${before} -> ${after}`)
console.log('nothing changed:', 'ok')

await prisma.$disconnect()
