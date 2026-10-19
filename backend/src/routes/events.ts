import { Router } from 'express'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../utils/prisma'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, optionalAuth, AuthRequest, requireAdmin } from '../middleware/auth'
import { atLeast, isGuest } from '../utils/roles'
import { isEventVisibleTo, tagVisibilityFilter } from '../utils/visibility'
import {
  isPubliclyVisibleNow,
  isRegistrationBlockedByTime,
  publishedVisibilityFilter,
  type AfterStartPolicy,
} from '../utils/eventPolicy'
import { sanitizeHtml } from '../utils/sanitizeHtml'
import { requireCaptcha } from '../utils/captcha'
import { logActivity, actorName } from '../utils/activityLog'
import {
  createBroadcast,
  notifyUser,
  removeBroadcastsFor,
} from '../utils/notifications'
import {
  createEventSchema,
  updateEventSchema,
  createListSchema,
  updateListSchema,
  registerForEventSchema,
  updateRegistrationSchema,
} from '../utils/validation'
import {
  withParsedEventJson,
  withParsedEventListJson,
  withParsedUserJson,
  withParsedUserListJson,
  serializeJsonField,
} from '../utils/serialize'

const router = Router()

const participantSelect = {
  id: true,
  name: true,
  avatar: true,
  phone: true,
  socialLinks: true,
} as const

const eventDetailInclude = {
  lists: {
    orderBy: { order: 'asc' as const },
    include: {
      registrations: {
        orderBy: { registeredAt: 'asc' as const },
        include: { user: { select: participantSelect } },
      },
    },
  },
  creator: {
    select: { id: true, name: true, avatar: true, email: true, phone: true, socialLinks: true },
  },
  host: { select: { id: true, name: true, avatar: true } },
  hosts: { select: { id: true, name: true, avatar: true, phone: true, socialLinks: true } },
  organizer: { select: { id: true, name: true, avatar: true, phone: true, socialLinks: true } },
  publicTags: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
  priceItems: { orderBy: { order: 'asc' } },
  images: { orderBy: { order: 'asc' } },
  // Needed to resolve tag visibility; replaced before responding to anyone.
  visibleTags: { select: { id: true, name: true } },
} as const

/**
 * Works out the stored end of the event.
 *
 * In DURATION mode the end is the start plus the duration, so "happening now"
 * and the policy checks stay one indexed comparison. In FIXED mode the
 * administrator's end time is used verbatim. A duration given alongside a
 * fixed end wins, because that is what makes the event "in progress".
 */
const resolveEndsAt = (options: {
  startsAt: Date
  durationMinutes: number | null | undefined
  endTimeMode: string
  explicitEndsAt: string | Date | null | undefined
  fallback: Date | null
}): Date | null => {
  const { startsAt, durationMinutes, endTimeMode, explicitEndsAt, fallback } = options

  if (durationMinutes && durationMinutes > 0) {
    return new Date(startsAt.getTime() + durationMinutes * 60_000)
  }
  if (endTimeMode === 'FIXED' && explicitEndsAt) {
    const parsed = new Date(explicitEndsAt)
    // A fixed end in the past would make the event permanently over.
    if (!Number.isNaN(parsed.getTime()) && parsed.getTime() > startsAt.getTime()) {
      return parsed
    }
    return null
  }
  return fallback ?? null
}

function parseEventWithUsers<T extends Record<string, any>>(event: T): T {
  const parsed = withParsedEventJson(event) as any
  if (parsed.lists) {
    parsed.lists = parsed.lists.map((list: any) => ({
      ...list,
      registrations: list.registrations?.map((r: any) => ({
        ...r,
        user: withParsedUserJson(r.user),
      })),
    }))
  }
  if (parsed.creator) parsed.creator = withParsedUserJson(parsed.creator)
  // Every user-shaped relation on the event carries the same socialLinks blob.
  if (parsed.organizer) parsed.organizer = withParsedUserJson(parsed.organizer)
  if (parsed.host) parsed.host = withParsedUserJson(parsed.host)
  if (Array.isArray(parsed.hosts)) {
    parsed.hosts = parsed.hosts.map((h: any) => withParsedUserJson(h))
  }
  return parsed as T
}

/**
 * `endsAt` is the stored end of the event. Keeping it as a column (rather than
 * computing `dateTime + duration` in a filter) keeps "is it still running" a
 * single indexed comparison, which SQLite cannot express otherwise.
 */
const computeEndsAt = (startsAt: Date, durationMinutes: number | null | undefined) =>
  durationMinutes && durationMinutes > 0
    ? new Date(startsAt.getTime() + durationMinutes * 60_000)
    : null

/**
 * Which published events belong on the home page for this viewer.
 *
 * The `afterStartPolicy` decides whether an event drops off once it starts or
 * stays listed; the tag clause is appended last so it ANDs with those rules.
 */
const publicVisibilityFilter = (now: Date, viewer?: AuthRequest['user']) => ({
  AND: [publishedVisibilityFilter(now), tagVisibilityFilter(viewer)],
})

router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const events = await prisma.event.findMany({
      where: publicVisibilityFilter(new Date(), req.user),
      include: {
        lists: { orderBy: { order: 'asc' } },
        creator: { select: { id: true, name: true, avatar: true } },
        host: { select: { id: true, name: true, avatar: true } },
        publicTags: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
        _count: { select: { registrations: true } },
      },
      orderBy: { dateTime: 'asc' },
    })

    const registrations = req.user
      ? await prisma.registration.findMany({
          where: { userId: req.user.id, eventId: { in: events.map((e) => e.id) } },
          include: { list: true },
        })
      : []

    const byEvent = new Map(registrations.map((r) => [r.eventId, r]))
    const isAdmin = atLeast(req.user?.role, 'ADMIN')

    const payload = withParsedEventListJson(events).map((event: any) => {
      const base = { ...event, userRegistration: byEvent.get(event.id) ?? null }
      // Tag configuration is administrator-only. Hidden events are already
      // filtered out by the query, so nothing here reveals which tags exist.
      if (!isAdmin) {
        delete base.visibilityMode
        delete base.visibleTags
      }
      return base
    })

    res.json({ events: payload })
  })
)

/**
 * Validates a requested tag id list. In ALL mode the list is emptied, so
 * switching back to "everyone" cannot leave a stale restriction behind.
 *
 * Both `id` and `name` come back because the two nested-write shapes differ:
 * creating a relation needs Tag scalars, while replacing one can reference the
 * existing rows by their unique id.
 */
const resolveTagLinks = async (
  tagIds: string[] | undefined,
  visibilityMode: string | undefined
): Promise<{ id: string; name: string }[]> => {
  const effectiveMode = visibilityMode ?? 'ALL'
  const ids = effectiveMode === 'ALL' ? [] : (tagIds ?? [])

  if (ids.length === 0) {
    return []
  }

  const unique = [...new Set(ids)]
  const found = await prisma.tag.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  })

  if (found.length !== unique.length) {
    throw new AppError(400, 'One or more tags do not exist')
  }

  return found
}

/** Validates host ids and returns connect targets for the relation. */
const resolveHostLinks = async (hostIds: string[] | undefined) => {
  if (!hostIds) return []
  const unique = [...new Set(hostIds)]
  if (unique.length === 0) return []
  const found = await prisma.user.count({ where: { id: { in: unique } } })
  if (found !== unique.length) {
    throw new AppError(400, 'One or more hosts do not exist')
  }
  return unique.map((id) => ({ id }))
}

/** Validates the publicly displayed tag ids. */
const resolvePublicTagLinks = async (tagIds: string[] | undefined) => {
  if (!tagIds || tagIds.length === 0) return []
  const unique = [...new Set(tagIds)]
  const found = await prisma.tag.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  })
  if (found.length !== unique.length) {
    throw new AppError(400, 'One or more public tags do not exist')
  }
  return found
}

/** Rejects a key that is already taken by another event. */
const assertKeyAvailable = async (key: string | undefined, currentId?: string) => {
  if (!key) return
  const clash = await prisma.event.findUnique({ where: { key }, select: { id: true } })
  if (clash && clash.id !== currentId) {
    throw new AppError(409, 'That key is already used by another event')
  }
}

/**
 * Builds the gallery list: the explicit `images` array, falling back to the
 * single `coverImage`, with blanks dropped and duplicates removed.
 */
const normalizeImages = (images: string[] | undefined, coverImage: unknown): string[] => {
  const pool = [
    ...(Array.isArray(images) ? images : []),
    ...(typeof coverImage === 'string' && coverImage ? [coverImage] : []),
  ]
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of pool) {
    const url = String(raw).trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

const findEventForViewer = async (
  where: { id: string } | { key: string },
  viewer?: { id: string; role: string }
) => {
  const event = await prisma.event.findUnique({
    where,
    include: eventDetailInclude,
  })
  if (!event) {
    throw new AppError(404, 'Event not found')
  }
  if (!event.isPublished && !atLeast(viewer?.role, 'ADMIN')) {
    throw new AppError(404, 'Event not found')
  }

  // A policy that unpublishes at the start also closes the direct link, so the
  // page cannot be reached by guessing the id.
  if (
    !atLeast(viewer?.role, 'ADMIN') &&
    event.isPublished &&
    !isPubliclyVisibleNow(event)
  ) {
    throw new AppError(404, 'Event not found')
  }

  // Tag-restricted events are indistinguishable from missing ones for anyone
  // without the required tag, so this also 404s rather than 403s.
  if (!(await isEventVisibleTo(event, viewer))) {
    throw new AppError(404, 'Event not found')
  }

  const userRegistration = viewer
    ? await prisma.registration.findUnique({
        where: { userId_eventId: { userId: viewer.id, eventId: event.id } },
        include: { list: true },
      })
    : null

  const parsed = parseEventWithUsers({ ...event, userRegistration }) as Record<string, unknown>

  // Tag *configuration* is administrator-only. The public tags are different:
  // they are meant to be shown, so they are left in place.
  if (!atLeast(viewer?.role, 'ADMIN')) {
    delete parsed.visibleTags
  }

  // Guests may look at an event but not at who is attending it.
  if (isGuest(viewer?.role) && Array.isArray(parsed.lists)) {
    parsed.lists = (parsed.lists as unknown[]).map((list) => {
      const { registrations, ...rest } = list as Record<string, unknown>
      return {
        ...rest,
        registrationCount: Array.isArray(registrations) ? registrations.length : 0,
      }
    })
  }

  return parsed
}

router.get(
  '/key/:key',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const event = await findEventForViewer({ key: req.params.key }, req.user)
    res.json({ event })
  })
)

router.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const event = await findEventForViewer({ id: req.params.id }, req.user)
    res.json({ event })
  })
)

router.post(
  '/',
  authMiddleware,
  requireAdmin,
  requireCaptcha('event-create'),
  asyncHandler(async (req: AuthRequest, res) => {
    const data = createEventSchema.parse(req.body)

    const {
      pageStyle,
      layout,
      dateTime,
      visibleTagIds,
      visibilityMode,
      publicTagIds,
      hostIds,
      organizerId,
      contactMode,
      endTimeMode,
      endsAt: explicitEndsAt,
      afterStartPolicy,
      priceItems,
      images,
      ...rest
    } = data
    const startsAt = new Date(dateTime)
    const tags = await resolveTagLinks(visibleTagIds, visibilityMode)
    const pubTags = await resolvePublicTagLinks(publicTagIds)
    const hosts = await resolveHostLinks(hostIds)
    const policy = (afterStartPolicy ?? 'UNPUBLISH_AT_START') as AfterStartPolicy
    const gallery = normalizeImages(images, rest.coverImage)
    await assertKeyAvailable(rest.key)

    const event = await prisma.event.create({
      data: {
        ...rest,
        description: sanitizeHtml(rest.description) || null,
        // The first gallery image doubles as the cover, kept in step for
        // anything still reading `coverImage`.
        coverImage: gallery[0] ?? null,
        address: rest.address || null,
        contactInfo: rest.contactInfo || null,
        hostId: rest.hostId || null,
        durationMinutes: rest.durationMinutes ?? null,
        endTimeMode: endTimeMode ?? 'DURATION',
        afterStartPolicy: policy,
        // Kept in step for older clients and the legacy index.
        unpublishAfterEnd: policy !== 'UNPUBLISH_AT_START',
        organizerId: organizerId ?? req.user!.id,
        contactMode: contactMode ?? 'PROFILE',
        dateTime: startsAt,
        endsAt: resolveEndsAt({
          startsAt,
          durationMinutes: rest.durationMinutes,
          endTimeMode: endTimeMode ?? 'DURATION',
          explicitEndsAt,
          fallback: null,
        }),
        visibilityMode: visibilityMode ?? 'ALL',
        // `connect`, not `create`: the tags already exist, and creating rows
        // with the same name would violate the unique constraint.
        visibleTags: { connect: tags.map((t) => ({ id: t.id })) },
        publicTags: { connect: pubTags.map((t) => ({ id: t.id })) },
        hosts: { connect: hosts },
        pageStyle: serializeJsonField(pageStyle) ?? null,
        layout: serializeJsonField(layout) ?? null,
        creatorId: req.user!.id,
        ...(gallery.length
          ? { images: { create: gallery.map((url, i) => ({ url, order: i })) } }
          : {}),
        ...(priceItems?.length
          ? {
              priceItems: {
                create: priceItems.map((p, i) => ({
                  name: p.name,
                  price: p.price,
                  // Each charge defaults to the event's own currency.
                  currency: p.currency ?? rest.currency ?? '$',
                  order: i,
                })),
              },
            }
          : {}),
        lists: {
          create: [
            { name: 'Main List', isDefault: true, order: 0 },
            { name: 'Waitlist', isDefault: false, order: 1 },
          ],
        },
      },
      include: {
        lists: { orderBy: { order: 'asc' } },
        priceItems: { orderBy: { order: 'asc' } },
        images: { orderBy: { order: 'asc' } },
      },
    })

    res.status(201).json({ event: withParsedEventJson(event) })

    await logActivity({
      category: 'EVENT_CREATED',
      actorId: req.user!.id,
      actorName: await actorName(req.user!.id),
      targetType: 'EVENT',
      targetId: event.id,
      targetName: event.title,
      detail: event.dateTime.toISOString(),
    })
    // A new event is a broadcast: every user who can see it is told.
    await createBroadcast({
      type: 'EVENT_CREATED',
      sourceType: 'EVENT',
      sourceId: event.id,
      title: event.title,
      meta: { startsAt: event.dateTime.toISOString() },
    })
  })
)

router.patch(
  '/:id',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = updateEventSchema.parse(req.body)

    const existing = await prisma.event.findUnique({ where: { id: req.params.id } })
    if (!existing) {
      throw new AppError(404, 'Event not found')
    }

    const {
      pageStyle,
      layout,
      dateTime,
      durationMinutes,
      visibleTagIds,
      visibilityMode,
      publicTagIds,
      hostIds,
      organizerId,
      contactMode,
      endTimeMode,
      endsAt: explicitEndsAt,
      afterStartPolicy,
      priceItems,
      images,
      ...rest
    } = data

    await assertKeyAvailable(rest.key, req.params.id)

    // Recompute the stored end whenever the start or the timeframe moves.
    const startsAt = dateTime !== undefined ? new Date(dateTime) : existing.dateTime
    const effectiveDuration =
      durationMinutes !== undefined ? durationMinutes : existing.durationMinutes
    const effectiveEndMode = endTimeMode ?? existing.endTimeMode

    // Tag links are rewritten when explicit ids arrive, or when the event
    // becomes visible to everyone (which must clear a stale restriction).
    // A request that only repeats the mode leaves the selection alone, so
    // re-saving the mode cannot silently drop the configured tags.
    const effectiveMode = visibilityMode ?? existing.visibilityMode
    const shouldRewriteTags = visibleTagIds !== undefined || effectiveMode === 'ALL'
    const tagLinks = shouldRewriteTags
      ? await resolveTagLinks(visibleTagIds, effectiveMode)
      : undefined
    const pubTags = publicTagIds !== undefined ? await resolvePublicTagLinks(publicTagIds) : undefined
    const hosts = hostIds !== undefined ? await resolveHostLinks(hostIds) : undefined

    const policy = afterStartPolicy ?? (existing.afterStartPolicy as AfterStartPolicy)

    // Only rewrite the gallery when the request mentions images or the cover,
    // so an unrelated PATCH cannot wipe them.
    const gallery =
      images !== undefined || rest.coverImage !== undefined
        ? normalizeImages(images, rest.coverImage)
        : null

    const updateData: Prisma.EventUncheckedUpdateInput = {
      ...rest,
      ...(gallery !== null ? { coverImage: gallery[0] ?? null } : {}),
      ...(rest.description !== undefined
        ? { description: sanitizeHtml(rest.description) || null }
        : {}),
      ...(dateTime !== undefined ? { dateTime: startsAt } : {}),
      ...(durationMinutes !== undefined ? { durationMinutes: durationMinutes ?? null } : {}),
      ...(endTimeMode !== undefined ? { endTimeMode } : {}),
      endsAt: resolveEndsAt({
        startsAt,
        durationMinutes: effectiveDuration,
        endTimeMode: effectiveEndMode,
        explicitEndsAt: explicitEndsAt !== undefined ? explicitEndsAt : existing.endsAt,
        fallback: existing.endsAt,
      }),
      ...(afterStartPolicy !== undefined
        ? {
            afterStartPolicy: policy,
            unpublishAfterEnd: policy !== 'UNPUBLISH_AT_START',
          }
        : {}),
      ...(organizerId !== undefined ? { organizerId: organizerId ?? null } : {}),
      ...(contactMode !== undefined ? { contactMode } : {}),
      ...(visibilityMode !== undefined ? { visibilityMode } : {}),
      ...(tagLinks !== undefined
        ? { visibleTags: { set: tagLinks.map((t) => ({ id: t.id })) } }
        : {}),
      ...(pubTags !== undefined
        ? { publicTags: { set: pubTags.map((t) => ({ id: t.id })) } }
        : {}),
      ...(hosts !== undefined ? { hosts: { set: hosts } } : {}),
      ...(pageStyle !== undefined ? { pageStyle: serializeJsonField(pageStyle) ?? null } : {}),
      ...(layout !== undefined ? { layout: serializeJsonField(layout) ?? null } : {}),
    }

    const event = await prisma.event.update({
      where: { id: req.params.id },
      data: {
        ...updateData,
        ...(gallery !== null
          ? {
              images: {
                deleteMany: {},
                create: gallery.map((url, i) => ({ url, order: i })),
              },
            }
          : {}),
        ...(priceItems !== undefined
          ? {
              priceItems: {
                deleteMany: {},
                create: priceItems.map((p, i) => ({
                  name: p.name,
                  price: p.price,
                  currency: p.currency ?? rest.currency ?? existing.currency ?? '$',
                  order: i,
                })),
              },
            }
          : {}),
      },
      include: {
        lists: { orderBy: { order: 'asc' } },
        priceItems: { orderBy: { order: 'asc' } },
        images: { orderBy: { order: 'asc' } },
      },
    })

    res.json({ event: withParsedEventJson(event) })
  })
)

router.delete(
  '/:id',
  authMiddleware,
  requireAdmin,
  requireCaptcha('event-delete'),
  asyncHandler(async (req: AuthRequest, res) => {
    const existing = await prisma.event.findUnique({ where: { id: req.params.id } })
    if (!existing) {
      throw new AppError(404, 'Event not found')
    }

    await prisma.event.delete({ where: { id: req.params.id } })
    // The event's notifications leave the system with it.
    await removeBroadcastsFor('EVENT', req.params.id)
    res.json({ message: 'Event deleted' })
  })
)

router.post(
  '/:id/lists',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = createListSchema.parse(req.body)

    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { lists: { select: { id: true } } },
    })
    if (!event) {
      throw new AppError(404, 'Event not found')
    }

    const maxOrder = await prisma.participantList.aggregate({
      where: { eventId: req.params.id },
      _max: { order: true },
    })

    const isDefault = data.isDefault ?? false
    if (isDefault) {
      await prisma.participantList.updateMany({
        where: { eventId: req.params.id, isDefault: true },
        data: { isDefault: false },
      })
    }

    const list = await prisma.participantList.create({
      data: {
        name: data.name,
        eventId: req.params.id,
        order: (maxOrder._max.order ?? -1) + 1,
        isDefault,
      },
    })

    res.status(201).json({ list })
  })
)

router.patch(
  '/:id/lists/:listId',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = updateListSchema.parse(req.body)

    const list = await prisma.participantList.findUnique({ where: { id: req.params.listId } })
    if (!list || list.eventId !== req.params.id) {
      throw new AppError(404, 'List not found')
    }

    if (data.isDefault) {
      await prisma.participantList.updateMany({
        where: { eventId: req.params.id, isDefault: true, id: { not: list.id } },
        data: { isDefault: false },
      })
    }

    const updated = await prisma.participantList.update({
      where: { id: req.params.listId },
      data,
    })

    res.json({ list: updated })
  })
)

router.delete(
  '/:id/lists/:listId',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const list = await prisma.participantList.findUnique({
      where: { id: req.params.listId },
      include: { _count: { select: { registrations: true } } },
    })
    if (!list || list.eventId !== req.params.id) {
      throw new AppError(404, 'List not found')
    }

    const listCount = await prisma.participantList.count({ where: { eventId: req.params.id } })
    if (listCount <= 1) {
      throw new AppError(400, 'An event must keep at least one participant list')
    }

    if (list._count.registrations > 0) {
      throw new AppError(
        400,
        `This list still has ${list._count.registrations} registration(s). Move or remove them first.`
      )
    }

    if (list.isDefault) {
      const replacement = await prisma.participantList.findFirst({
        where: { eventId: req.params.id, id: { not: list.id } },
        orderBy: { order: 'asc' },
      })
      if (replacement) {
        await prisma.participantList.update({
          where: { id: replacement.id },
          data: { isDefault: true },
        })
      }
    }

    await prisma.participantList.delete({ where: { id: req.params.listId } })
    res.json({ message: 'List deleted' })
  })
)

router.post(
  '/:id/register',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    // Guests are waiting for approval and cannot sign up for anything yet.
    if (isGuest(req.user!.role)) {
      throw new AppError(
        403,
        'Your account is awaiting administrator approval, so registration is not available yet'
      )
    }

    const data = registerForEventSchema.parse(req.body)

    const event = await prisma.event.findUnique({
      where: { id: req.params.id },
      include: { lists: true, visibleTags: { select: { id: true } } },
    })
    if (!event) {
      throw new AppError(404, 'Event not found')
    }
    if (!event.isPublished) {
      throw new AppError(400, 'This event is not open for registration')
    }
    // Same 404 as the page itself, so a hidden event cannot be probed by id.
    if (!isPubliclyVisibleNow(event)) {
      throw new AppError(404, 'Event not found')
    }
    // Tag rules gate registration as well as listing, so a restricted event
    // cannot be signed up for by guessing its id.
    if (!(await isEventVisibleTo(event, req.user))) {
      throw new AppError(403, 'This event is not available to you')
    }
    if (isRegistrationBlockedByTime(event)) {
      throw new AppError(
        400,
        event.afterStartPolicy === 'OPEN_AFTER_START'
          ? 'This event has finished'
          : 'This event has already started'
      )
    }

    const list = event.lists.find((l) => l.id === data.listId)
    if (!list) {
      throw new AppError(404, 'Participant list not found')
    }

    const existing = await prisma.registration.findUnique({
      where: { userId_eventId: { userId: req.user!.id, eventId: req.params.id } },
    })
    if (existing) {
      throw new AppError(409, 'You are already registered for this event')
    }

    const registration = await prisma.registration.create({
      data: {
        userId: req.user!.id,
        eventId: req.params.id,
        listId: data.listId,
        status: 'PENDING',
      },
      include: { list: true, user: { select: { id: true, name: true, avatar: true } } },
    })

    res.status(201).json({ registration })
  })
)

router.delete(
  '/:id/register',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const registration = await prisma.registration.findUnique({
      where: { userId_eventId: { userId: req.user!.id, eventId: req.params.id } },
    })
    if (!registration) {
      throw new AppError(404, 'Registration not found')
    }

    await prisma.registration.delete({ where: { id: registration.id } })
    res.json({ message: 'Registration cancelled' })
  })
)

router.patch(
  '/:id/registrations/:registrationId',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = updateRegistrationSchema.parse(req.body)

    const registration = await prisma.registration.findUnique({
      where: { id: req.params.registrationId },
    })
    if (!registration || registration.eventId !== req.params.id) {
      throw new AppError(404, 'Registration not found')
    }

    if (data.listId) {
      const list = await prisma.participantList.findUnique({ where: { id: data.listId } })
      if (!list || list.eventId !== req.params.id) {
        throw new AppError(404, 'Participant list not found')
      }
    }

    const isConfirming = data.status === 'CONFIRMED'
    const wasConfirmed = registration.status === 'CONFIRMED'
    const isMoving = Boolean(data.listId) && data.listId !== registration.listId

    const updated = await prisma.registration.update({
      where: { id: req.params.registrationId },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(isConfirming
          ? { confirmedAt: new Date(), confirmedById: req.user!.id }
          : data.status !== undefined
            ? { confirmedAt: null, confirmedById: null }
            : {}),
        ...(data.listId ? { listId: data.listId } : {}),
      },
      include: {
        user: { select: participantSelect },
        list: true,
        event: { select: { title: true } },
      },
    })

    // Confirmation and a change of list are each worth a notification, so
    // the participant hears about them without having to look.
    if (updated.event && updated.user.id !== req.user!.id) {
      if (isConfirming && !wasConfirmed) {
        await notifyUser({
          userId: updated.user.id,
          type: 'REGISTRATION_CONFIRMED',
          title: updated.event.title,
          targetType: 'EVENT',
          targetId: updated.eventId,
        })
      } else if (isMoving && updated.list) {
        await notifyUser({
          userId: updated.user.id,
          type: 'LIST_TRANSFER',
          title: updated.event.title,
          targetType: 'EVENT',
          targetId: updated.eventId,
          meta: { listName: updated.list.name },
        })
      }
    }

    res.json({
      registration: {
        ...updated,
        // The event travels with the row for the notification; the response
        // keeps the shape every caller already expects.
        event: undefined,
        user: withParsedUserJson(updated.user),
      },
    })
  })
)

export { router }