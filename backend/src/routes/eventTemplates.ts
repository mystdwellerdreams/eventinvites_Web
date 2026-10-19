import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, AuthRequest, requireAdmin } from '../middleware/auth'
import { eventTemplateSchema } from '../utils/validation'

const router = Router()

const templateSelect = {
  id: true,
  name: true,
  createdAt: true,
  data: true,
  createdBy: { select: { id: true, name: true } },
} as const

/** Every saved template, newest first. Administrators share them all. */
router.get(
  '/',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (_req: AuthRequest, res) => {
    const templates = await prisma.eventTemplate.findMany({
      select: templateSelect,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ templates })
  })
)

/**
 * Saves the current editor settings as a template. The payload's shape is
 * the event create/update payload, so applying a template later is a
 * matter of reading the fields back into the editor.
 */
router.post(
  '/',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = eventTemplateSchema.parse(req.body)
    const template = await prisma.eventTemplate.create({
      data: {
        name: data.name,
        data: data.data,
        createdById: req.user!.id,
      },
      select: templateSelect,
    })
    res.status(201).json({ template })
  })
)

/** Removes a saved template. */
router.delete(
  '/:id',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const existing = await prisma.eventTemplate.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    })
    if (!existing) {
      throw new AppError(404, 'Template not found')
    }
    await prisma.eventTemplate.delete({ where: { id: existing.id } })
    res.json({ message: 'Template deleted' })
  })
)

export { router }
