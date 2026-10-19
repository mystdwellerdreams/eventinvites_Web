import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, AuthRequest, requireAdmin } from '../middleware/auth'
import { GUEST_ROLE, isGuest } from '../utils/roles'
import { createInvite } from '../utils/invites'
import {
  assignRegistrationSchema,
  createInviteSchema,
  notifyParticipantsSchema,
  sendMessageSchema,
} from '../utils/validation'
import { withParsedUserJson, withParsedUserListJson } from '../utils/serialize'
import { logActivity, actorName } from '../utils/activityLog'
import { createBroadcast, notifyUser } from '../utils/notifications'
import { ensureChat, postChatMessage } from '../utils/chats'

const router = Router()

const participantSelect = {
  id: true,
  name: true,
  avatar: true,
  phone: true,
  email: true,
  socialLinks: true,
} as const

router.get(
  '/dashboard',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const [
      totalUsers,
      totalEvents,
      publishedEvents,
      totalRegistrations,
      confirmedRegistrations,
      totalTags,
      restrictedEvents,
      pendingGuests,
      recentRegistrations,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.event.count(),
      prisma.event.count({ where: { isPublished: true } }),
      prisma.registration.count(),
      prisma.registration.count({ where: { status: 'CONFIRMED' } }),
      prisma.tag.count(),
      prisma.event.count({ where: { visibilityMode: { in: ['INCLUDE', 'EXCLUDE'] } } }),
      prisma.user.count({ where: { role: GUEST_ROLE } }),
      prisma.registration.findMany({
        take: 10,
        orderBy: { registeredAt: 'desc' },
        include: {
          user: { select: participantSelect },
          event: { select: { id: true, title: true, dateTime: true } },
          list: { select: { name: true } },
        },
      }),
    ])

    res.json({
      stats: {
        totalUsers,
        totalEvents,
        publishedEvents,
        totalRegistrations,
        confirmedRegistrations,
        totalTags,
        restrictedEvents,
        pendingGuests,
      },
      recentRegistrations: recentRegistrations.map((r) => ({ ...r, user: withParsedUserJson(r.user) })),
    })
  })
)

router.get(
  '/events',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const events = await prisma.event.findMany({
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        lists: { orderBy: { order: 'asc' } },
        visibleTags: { select: { id: true, name: true } },
        _count: { select: { registrations: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ events })
  })
)

router.get(
  '/events/:id/registrations',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: {
        lists: {
          orderBy: { order: 'asc' },
          include: {
            registrations: {
              orderBy: { registeredAt: 'asc' },
              include: { user: { select: participantSelect } },
            },
          },
        },
      },
    })

    if (!event) {
      throw new AppError(404, 'Event not found')
    }

    res.json({
      event: {
        ...event,
        lists: event.lists.map((list) => ({
          ...list,
          registrations: list.registrations.map((r) => ({ ...r, user: withParsedUserJson(r.user) })),
        })),
      },
    })
  })
)

/** Assigns an existing user to one of the event's lists. */
router.post(
  '/events/:eventId/registrations',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = assignRegistrationSchema.parse(req.body)

    const event = await prisma.event.findUnique({
      where: { id: req.params.eventId },
    })
    if (!event) {
      throw new AppError(404, 'Event not found')
    }

    const user = await prisma.user.findUnique({ where: { id: data.userId } })
    if (!user) {
      throw new AppError(404, 'User not found')
    }
    // Guests are waiting for approval and cannot register for anything yet.
    if (isGuest(user.role)) {
      throw new AppError(
        400,
        'Guest accounts must be approved before they can be registered for events'
      )
    }

    const list = await prisma.participantList.findUnique({
      where: { id: data.listId },
    })
    if (!list || list.eventId !== req.params.eventId) {
      throw new AppError(404, 'Participant list not found')
    }

    const existing = await prisma.registration.findUnique({
      where: { userId_eventId: { userId: data.userId, eventId: req.params.eventId } },
    })
    if (existing) {
      throw new AppError(409, 'User is already registered for this event')
    }

    const registration = await prisma.registration.create({
      data: {
        userId: data.userId,
        eventId: req.params.eventId,
        listId: data.listId,
        status: 'PENDING',
      },
      include: { user: { select: participantSelect }, list: true },
    })

    res.status(201).json({
      registration: { ...registration, user: withParsedUserJson(registration.user) },
    })
  })
)

/** Guest accounts awaiting approval. */
router.get(
  '/guests',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const guests = await prisma.user.findMany({
      where: { role: GUEST_ROLE },
      select: { ...participantSelect, key: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ guests: withParsedUserListJson(guests) })
  })
)

/** Approves a guest, promoting them to a regular user. */
router.patch(
  '/guests/:id/approve',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const guest = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!guest) {
      throw new AppError(404, 'User not found')
    }
    if (guest.role !== GUEST_ROLE) {
      throw new AppError(400, 'That account is not a guest')
    }

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: { role: 'USER' },
      select: { ...participantSelect, key: true, createdAt: true },
    })

    await logActivity({
      category: 'GUEST_APPROVAL',
      actorId: req.user!.id,
      actorName: await actorName(req.user!.id),
      targetType: 'USER',
      targetId: updated.id,
      targetName: updated.name,
    })

    res.json({ user: withParsedUserJson(updated), message: `${updated.name} can now register for events` })
  })
)

/* --------------------------- password reset requests -------------------------- */

/** Pending password reset requests, for the Status tab. */
router.get(
  '/password-resets',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (_req: AuthRequest, res) => {
    const resets = await prisma.passwordReset.findMany({
      where: { usedAt: null, expiresAt: { gt: new Date() } },
      include: {
        user: { select: { id: true, name: true, phone: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ resets })
  })
)

/** Cancels a pending reset request, withdrawing its link. */
router.delete(
  '/password-resets/:id',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const reset = await prisma.passwordReset.findUnique({
      where: { id: req.params.id },
    })
    if (!reset) {
      throw new AppError(404, 'Reset request not found')
    }
    await prisma.passwordReset.delete({ where: { id: reset.id } })
    res.json({ message: 'Reset request cancelled' })
  })
)

/* ---------------------------------- invites --------------------------------- */

router.get(
  '/invites',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const invites = await prisma.invite.findMany({
      include: { createdBy: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    res.json({ invites })
  })
)

router.post(
  '/invites',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = createInviteSchema.parse(req.body)
    const invite = await createInvite({
      createdById: req.user!.id,
      note: data.note,
      maxUses: data.maxUses,
      expiresInDays: data.expiresInDays,
    })
    res.status(201).json({ invite })
  })
)

router.post(
  '/invites/:id/revoke',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const invite = await prisma.invite.update({
      where: { id: req.params.id },
      data: { revoked: true },
    })
    res.json({ invite, message: 'Invitation withdrawn' })
  })
)

router.patch(
  '/registrations/:registrationId/confirm',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const registration = await prisma.registration.findUnique({
      where: { id: req.params.registrationId },
    })
    if (!registration) {
      throw new AppError(404, 'Registration not found')
    }

    const updated = await prisma.registration.update({
      where: { id: req.params.registrationId },
      data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: req.user!.id },
      include: {
        user: { select: participantSelect },
        list: true,
        event: { select: { title: true } },
      },
    })

    if (updated.event && updated.user.id !== req.user!.id) {
      await notifyUser({
        userId: updated.user.id,
        type: 'REGISTRATION_CONFIRMED',
        title: updated.event.title,
        targetType: 'EVENT',
        targetId: updated.eventId,
      })
    }

    res.json({
      registration: {
        ...updated,
        event: undefined,
        user: withParsedUserJson(updated.user),
      },
    })
  })
)

router.patch(
  '/registrations/:registrationId/unconfirm',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const registration = await prisma.registration.findUnique({
      where: { id: req.params.registrationId },
    })
    if (!registration) {
      throw new AppError(404, 'Registration not found')
    }

    const updated = await prisma.registration.update({
      where: { id: req.params.registrationId },
      data: { status: 'PENDING', confirmedAt: null, confirmedById: null },
      include: { user: { select: participantSelect }, list: true },
    })

    res.json({ registration: { ...updated, user: withParsedUserJson(updated.user) } })
  })
)

router.delete(
  '/registrations/:registrationId',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const registration = await prisma.registration.findUnique({
      where: { id: req.params.registrationId },
    })
    if (!registration) {
      throw new AppError(404, 'Registration not found')
    }

    await prisma.registration.delete({ where: { id: req.params.registrationId } })

    // Being taken off a guest list is worth telling the participant about.
    const list = await prisma.participantList.findUnique({
      where: { id: registration.listId },
      select: { name: true },
    })
    const event = await prisma.event.findUnique({
      where: { id: registration.eventId },
      select: { title: true },
    })
    if (event) {
      await notifyUser({
        userId: registration.userId,
        type: 'LIST_REMOVAL',
        title: event.title,
        targetType: 'EVENT',
        targetId: registration.eventId,
        // The list's name is a detail the panel shows, so it travels as data
        // rather than as prose.
        meta: { listName: list?.name ?? null },
      })
    }

    res.json({ message: 'Registration removed' })
  })
)

/**
 * Opens a conversation with one user. An administrator reaches out under
 * their own name, and the message reaches the user as an individual
 * notification that opens the conversation in the Messages section.
 */
router.post(
  '/users/:id/messages',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = sendMessageSchema.parse(req.body)
    const target = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: { id: true, name: true, role: true },
    })
    if (!target) {
      throw new AppError(404, 'User not found')
    }

    const chat = await ensureChat('ADMIN', target.id, {
      adminId: req.user!.id,
    })
    await postChatMessage(chat.id, req.user!.id, data.message)

    res.status(201).json({ message: `Message sent to ${target.name}` })
  })
)

/**
 * Posts an organizer's update for one event. Everyone registered for that
 * event receives it as a broadcast notification.
 */
router.post(
  '/events/:id/notify',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = notifyParticipantsSchema.parse(req.body)
    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true },
    })
    if (!event) {
      throw new AppError(404, 'Event not found')
    }

    await createBroadcast({
      type: 'ORGANIZER_UPDATE',
      sourceType: 'EVENT',
      sourceId: event.id,
      title: event.title,
      message: data.message,
      senderId: req.user!.id,
      meta: { updateTitle: data.title },
    })

    res.status(201).json({ message: 'Update sent to the participants' })
  })
)

export { router }