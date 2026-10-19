import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, AuthRequest, requireAdmin } from '../middleware/auth'
import { updateRoleSchema } from '../utils/validation'
import { atLeast } from '../utils/roles'
import { withParsedUserJson, withParsedUserListJson } from '../utils/serialize'

const router = Router()

const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatar: true,
  phone: true,
  socialLinks: true,
  createdAt: true,
} as const

/** Administrator-only view: adds the tag list and the user's generated key. */
const adminUserSelect = {
  ...userSelect,
  key: true,
  tags: { select: { id: true, name: true }, orderBy: { name: 'asc' as const } },
} as const

router.get(
  '/key/:key',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { key: req.params.key },
      select: adminUserSelect,
    })
    if (!user) {
      throw new AppError(404, 'User not found')
    }
    res.json({ user: withParsedUserJson(user) })
  })
)

router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    // Every signed-in user may list users; only administrators
    // see the tag list and the generated key.
    const isAdmin = atLeast(req.user!.role, 'ADMIN')
    const users = await prisma.user.findMany({
      select: isAdmin ? adminUserSelect : userSelect,
      orderBy: { createdAt: 'desc' },
    })
    res.json({ users: withParsedUserListJson(users) })
  })
)

router.get(
  '/:id',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const isAdmin = atLeast(req.user!.role, 'ADMIN')
    if (!isAdmin && req.user!.id !== req.params.id) {
      throw new AppError(403, 'You can only view your own profile')
    }

    // A user never sees their own tags.
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: isAdmin ? adminUserSelect : userSelect,
    })
    if (!user) {
      throw new AppError(404, 'User not found')
    }

    res.json({ user: withParsedUserJson(user) })
  })
)

router.patch(
  '/:id/role',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const { role } = updateRoleSchema.parse(req.body)

    if (req.params.id === req.user!.id) {
      throw new AppError(400, 'You cannot change your own role')
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!user) {
      throw new AppError(404, 'User not found')
    }

    if (!atLeast(req.user!.role, user.role)) {
      throw new AppError(403, 'You cannot change the role of a more privileged user')
    }

    if (user.role === role) {
      res.json({ user: withParsedUserJson(user) })
      return
    }

    const privileged = (r: string) => atLeast(r, 'ADMIN')
    if (privileged(user.role) && !privileged(role)) {
      const adminCount = await prisma.user.count({ where: { role: { in: ['ADMIN'] } } })
      if (adminCount <= 1) {
        throw new AppError(400, 'At least one administrator must remain')
      }
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: userSelect,
    })

    res.json({ user: withParsedUserJson(updated) })
  })
)

router.delete(
  '/:id',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    if (req.params.id === req.user!.id) {
      throw new AppError(400, 'You cannot delete your own account')
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!user) {
      throw new AppError(404, 'User not found')
    }

    if (!atLeast(req.user!.role, user.role)) {
      throw new AppError(403, 'You cannot delete a more privileged user')
    }

    await prisma.user.delete({ where: { id: req.params.id } })
    res.json({ message: 'User deleted' })
  })
)

export { router }