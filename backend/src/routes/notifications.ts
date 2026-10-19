import { Router } from 'express'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import {
  deleteNotification,
  hideBroadcast,
  listForUser,
  markAllRead,
  markBroadcastRead,
  markNotificationRead,
} from '../utils/notifications'

const router = Router()

/**
 * Everything the signed-in user is allowed to see: the broadcasts they are
 * eligible for and the notifications addressed to them, newest first, with
 * unread counts. Anonymously there is nothing to list.
 */
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await listForUser(req.user!.id))
  })
)

/** Marks every notification broadcast and individual as read. */
router.post(
  '/read-all',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    await markAllRead(req.user!.id)
    res.json({ message: 'All notifications marked as read' })
  })
)

/** Marks one broadcast read. */
router.post(
  '/broadcasts/:id/read',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    await markBroadcastRead(req.user!.id, req.params.id)
    res.json({ message: 'Marked as read' })
  })
)

/**
 * Hides one broadcast for this user. The row stays in the system: it only
 * disappears for good when its event or announcement is deleted.
 */
router.delete(
  '/broadcasts/:id',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    await hideBroadcast(req.user!.id, req.params.id)
    res.json({ message: 'Notification hidden' })
  })
)

/** Marks one individual notification read. */
router.post(
  '/:id/read',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    await markNotificationRead(req.user!.id, req.params.id)
    res.json({ message: 'Marked as read' })
  })
)

/** Removes one individual notification for good. */
router.delete(
  '/:id',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const existing = await prisma.notification.findFirst({
      where: { id: req.params.id, userId: req.user!.id },
      select: { id: true },
    })
    if (!existing) {
      throw new AppError(404, 'Notification not found')
    }
    await deleteNotification(req.user!.id, existing.id)
    res.json({ message: 'Notification removed' })
  })
)

export { router }
