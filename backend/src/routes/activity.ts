import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, requireAdmin } from '../middleware/auth'
import { activityQuerySchema, updateActivitySettingsSchema } from '../utils/validation'
import { queryValue } from '../types'
import {
  areCommentsLogged,
  ensureUpcomingEventEntries,
  setCommentsLogged,
} from '../utils/activityLog'

const router = Router()

router.use(authMiddleware, requireAdmin)

/** How many entries the listing keeps. */
const MAX_ENTRIES = 300

/**
 * The activity log, newest first by default. `sort=asc` turns it around and
 * `category=FEEDBACK` (or any other category) narrows it to one kind of
 * entry; without either, every category shows.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const query = activityQuerySchema.parse({
      category: queryValue(req.query.category),
      sort: queryValue(req.query.sort),
    })

    // An event that has come into range is announced here, once.
    await ensureUpcomingEventEntries()

    const entries = await prisma.activityLog.findMany({
      where:
        query.category && query.category !== 'ALL'
          ? { category: query.category }
          : {},
      orderBy: { createdAt: query.sort === 'asc' ? 'asc' : 'desc' },
      take: MAX_ENTRIES,
    })

    res.json({
      entries: entries.map((entry) => ({
        ...entry,
        // Stored as a JSON string; the client wants the object.
        meta: entry.meta ? safeParse(entry.meta) : null,
      })),
      settings: { logComments: await areCommentsLogged() },
    })
  })
)

/** Turns comment logging on or off. Off is the default. */
router.patch(
  '/settings',
  asyncHandler(async (req, res) => {
    const data = updateActivitySettingsSchema.parse(req.body)
    await setCommentsLogged(data.logComments)
    res.json({ settings: { logComments: data.logComments } })
  })
)

/** Removes one entry. The log is a curator's tool, so a line can be
 *  dropped once it has served its purpose. */
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id
    // Ids are uuid v4; anything else cannot exist, and Prisma would throw
    // on the malformed value before the lookup ever happens.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      throw new AppError(404, 'Entry not found')
    }
    const entry = await prisma.activityLog.findUnique({
      where: { id },
      select: { id: true },
    })
    if (!entry) {
      throw new AppError(404, 'Entry not found')
    }
    await prisma.activityLog.delete({ where: { id: entry.id } })
    res.json({ message: 'Entry removed' })
  })
)

/** Clears the whole log. Confirmed on the client before it is called. */
router.delete(
  '/',
  asyncHandler(async (_req, res) => {
    const removed = await prisma.activityLog.deleteMany({})
    res.json({ message: 'Log cleared', removed: removed.count })
  })
)

/** Never throws: a malformed meta payload simply comes back as null. */
function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export { router }
