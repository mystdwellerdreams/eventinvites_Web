import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, requireAdmin } from '../middleware/auth'
import { createTagSchema, updateTagSchema, setUserTagsSchema } from '../utils/validation'

const router = Router()

// Every tag route is administrator-only: tags are never exposed to regular
// users, so there is no authenticated non-admin surface here at all.
router.use(authMiddleware, requireAdmin)

const tagSelect = { id: true, name: true, createdAt: true } as const

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const tags = await prisma.tag.findMany({
      select: {
        ...tagSelect,
        _count: { select: { users: true, events: true } },
      },
      orderBy: { name: 'asc' },
    })
    res.json({ tags })
  })
)

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name } = createTagSchema.parse(req.body)

    const existing = await prisma.tag.findUnique({ where: { name } })
    if (existing) {
      throw new AppError(409, 'A tag with that name already exists')
    }

    const tag = await prisma.tag.create({ data: { name }, select: tagSelect })
    res.status(201).json({ tag })
  })
)

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { name } = updateTagSchema.parse(req.body)
    if (!name) {
      throw new AppError(400, 'Tag name is required')
    }

    const existing = await prisma.tag.findUnique({ where: { id: req.params.id } })
    if (!existing) {
      throw new AppError(404, 'Tag not found')
    }

    const clash = await prisma.tag.findFirst({
      where: { name, id: { not: req.params.id } },
      select: { id: true },
    })
    if (clash) {
      throw new AppError(409, 'A tag with that name already exists')
    }

    const tag = await prisma.tag.update({
      where: { id: req.params.id },
      data: { name },
      select: tagSelect,
    })
    res.json({ tag })
  })
)

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.tag.findUnique({
      where: { id: req.params.id },
      include: { _count: { select: { users: true, events: true } } },
    })
    if (!existing) {
      throw new AppError(404, 'Tag not found')
    }

    // Implicit many-to-many rows cascade, but an EXCLUDE event silently
    // opening up to everyone is a surprise worth making explicit.
    if (existing._count.events > 0) {
      throw new AppError(
        400,
        `This tag still affects ${existing._count.events} event(s). Remove it from those events first.`
      )
    }

    await prisma.tag.delete({ where: { id: req.params.id } })
    res.json({ message: 'Tag deleted' })
  })
)

/** Replaces the full tag set on one user. */
router.put(
  '/users/:userId',
  asyncHandler(async (req, res) => {
    const { tagIds } = setUserTagsSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { id: req.params.userId } })
    if (!user) {
      throw new AppError(404, 'User not found')
    }

    const unique = [...new Set(tagIds)]
    if (unique.length > 0) {
      const found = await prisma.tag.count({ where: { id: { in: unique } } })
      if (found !== unique.length) {
        throw new AppError(400, 'One or more tags do not exist')
      }
    }

    await prisma.user.update({
      where: { id: req.params.userId },
      // Implicit many-to-many, so nested writes take Tag scalars.
      data: { tags: { set: unique.map((id) => ({ id })) } },
      select: { id: true, tags: { select: { id: true, name: true }, orderBy: { name: 'asc' } } },
    })

    res.json({ message: 'Tags updated' })
  })
)

export { router }
