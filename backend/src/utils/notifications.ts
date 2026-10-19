import { randomUUID } from 'node:crypto'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from './prisma'
import { isEventVisibleTo } from './visibility'
import { isPubliclyVisibleNow } from './eventPolicy'
import { atLeast, ROLES } from './roles'
import { sanitizeHtml } from './sanitizeHtml'
import {
  isPushConfigured,
  sendPushMessages,
  sendPushToUserIds,
  type PushMessage,
} from './push'

/** Broadcast kinds: one row, every eligible user. */
export const BROADCAST_TYPES = [
  'EVENT_CREATED',
  'EVENT_REMINDER',
  'ORGANIZER_UPDATE',
  'ANNOUNCEMENT',
] as const
export type BroadcastType = (typeof BROADCAST_TYPES)[number]

/** Individual kinds: one row, one user. */
export const NOTIFICATION_TYPES = [
  'COMMENT_REPLY',
  'COMMENT_BAN',
  'COMMENT_BLOCK',
  'ADMIN_MESSAGE',
  'CHAT_MESSAGE',
  'REGISTRATION_CONFIRMED',
  'LIST_TRANSFER',
  'LIST_REMOVAL',
  'PASSWORD_RESET',
  'PASSWORD_ADVICE',
] as const
export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

export interface BroadcastInput {
  type: BroadcastType
  /** EVENT or BANNER_AD. */
  sourceType: 'EVENT' | 'BANNER_AD'
  sourceId: string
  title: string
  message?: string | null
  /** JSON extras, such as the date a reminder points at. */
  meta?: unknown
  /** The organizer behind an update. */
  senderId?: string | null
}

export interface NotificationInput {
  userId: string
  type: NotificationType
  /** Optional for system notifications: the row is labelled by its type. */
  title?: string
  message?: string | null
  /** EVENT, COMMENT, BANNER_AD, USER or CHAT. */
  targetType?: 'EVENT' | 'COMMENT' | 'BANNER_AD' | 'USER' | 'CHAT' | null
  targetId?: string | null
  /** JSON extras, such as which event a comment belongs to. */
  meta?: unknown
}

/**
 * Writes one per-user notification. Never throws for the caller: a failed
 * notification must not turn a completed action into an error.
 */
export async function notifyUser(input: NotificationInput): Promise<void> {
  try {
    const id = randomUUID()
    await prisma.notification.create({
      data: {
        id,
        userId: input.userId,
        type: input.type,
        title: input.title ?? '',
        message: input.message ? sanitizeHtml(input.message) : null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        meta: input.meta === undefined || input.meta === null
          ? null
          : JSON.stringify(input.meta),
      },
    })

    // The same event also reaches the user's phone, when push is configured.
    await sendPushMessages([
      individualPush({
        id,
        userId: input.userId,
        type: input.type,
        title: input.title ?? '',
        message: input.message ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        meta: input.meta ?? null,
      }),
    ])
  } catch (err) {
    console.error('[notifications] failed to write one', err)
  }
}

/**
 * Writes one notification for each of several users in a single round-trip.
 * For an event's thread, where every participant hears about a new message,
 * a row per user otherwise costs one insert each inside the request.
 * Like notifyUser, it never throws for the caller.
 */
export async function notifyUsers(
  inputs: NotificationInput[]
): Promise<void> {
  if (inputs.length === 0) return
  try {
    const rows = inputs.map((input) => ({
      id: randomUUID(),
      userId: input.userId,
      type: input.type,
      title: input.title ?? '',
      message: input.message ? sanitizeHtml(input.message) : null,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      meta: input.meta === undefined || input.meta === null
        ? null
        : JSON.stringify(input.meta),
    }))

    await prisma.notification.createMany({ data: rows })

    // One FCM request per device, sent after the rows exist so a tapped push
    // finds the notification it points at.
    await sendPushMessages(
      rows.map((row, index) =>
        individualPush({
          ...row,
          message: inputs[index].message ?? null,
          meta: inputs[index].meta ?? null,
        })
      )
    )
  } catch (err) {
    console.error('[notifications] failed to write several', err)
  }
}

/** Writes one broadcast, shared by every user it applies to. */
export async function createBroadcast(input: BroadcastInput): Promise<void> {
  let row: {
    id: string
    type: string
    sourceType: string
    sourceId: string
    title: string
    message: string | null
  } | null = null
  try {
    row = await prisma.broadcastNotification.create({
      data: {
        type: input.type,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        title: input.title,
        message: input.message ? sanitizeHtml(input.message) : null,
        meta: input.meta === undefined || input.meta === null
          ? null
          : JSON.stringify(input.meta),
        senderId: input.senderId ?? null,
      },
      select: {
        id: true,
        type: true,
        sourceType: true,
        sourceId: true,
        title: true,
        message: true,
      },
    })
  } catch (err) {
    console.error('[notifications] failed to write broadcast', err)
    return
  }

  // Eligibility for a broadcast is worked out per user; the push goes only to
  // the users the bell would show it to.
  try {
    await pushBroadcast(row, input)
  } catch (err) {
    console.error('[notifications] failed to push broadcast', err)
  }
}

/** Takes every broadcast tied to a source out of the system with it. */
export async function removeBroadcastsFor(
  sourceType: 'EVENT' | 'BANNER_AD',
  sourceId: string
): Promise<void> {
  await prisma.broadcastNotification.deleteMany({ where: { sourceType, sourceId } })
}

/* ------------------------- push notification bridge ----------------------- */

/**
 * The push text is generated here rather than in the app so a notification that
 * arrives while the app is closed still says something useful: FCM displays the
 * `notification` block itself, and only the `data` block reaches app code. The
 * strings are English, like the API's own error messages; the row's own content
 * (an event title, an administrator's message) is carried through untouched.
 */
const NOTIFICATION_TITLES: Record<string, string> = {
  COMMENT_REPLY: 'Reply to your comment',
  COMMENT_BAN: 'Comment banned',
  COMMENT_BLOCK: 'Commenting blocked',
  ADMIN_MESSAGE: 'Message from the administrators',
  CHAT_MESSAGE: 'New message',
  REGISTRATION_CONFIRMED: 'Registration confirmed',
  LIST_TRANSFER: 'Moved to another list',
  LIST_REMOVAL: 'Removed from the list',
  PASSWORD_RESET: 'Password reset prepared',
  PASSWORD_ADVICE: 'Please choose a password',
}

const BROADCAST_TITLES: Record<string, string> = {
  EVENT_CREATED: 'New event',
  EVENT_REMINDER: 'Event reminder',
  ORGANIZER_UPDATE: "Organizer's update",
  ANNOUNCEMENT: 'New announcement',
}

/** The roles that bypass tag visibility, so they hear about every event. */
const ADMIN_ROLES = ROLES.filter((role) => atLeast(role.key, 'ADMIN')).map(
  (role) => role.key
)

/**
 * One broadcast is pushed to at most this many users. A club event reaches a
 * small audience; the ceiling is here so a pathological fan-out cannot run the
 * API function past its time limit. Everyone beyond it still sees the row in
 * the bell, which is where eligibility is finally resolved.
 */
const MAX_PUSH_RECIPIENTS = 2000

interface IndividualPushRow {
  id: string
  userId: string
  type: string
  title: string
  message: string | null
  targetType: string | null
  targetId: string | null
  meta: unknown
}

/**
 * One notification as a push: the same words the bell shows, plus the route the
 * app opens when the notification is tapped and the id it marks read.
 */
function individualPush(row: IndividualPushRow): PushMessage {
  const meta = recordOf(row.meta)
  return {
    userId: row.userId,
    title: row.title || NOTIFICATION_TITLES[row.type] || 'Event Invites',
    body: plainText(row.message) || NOTIFICATION_TITLES[row.type] || '',
    data: {
      kind: 'individual',
      notificationId: row.id,
      type: row.type,
      route: routeForIndividual(row, meta),
    },
  }
}

/** Where tapping a personal notification leads, mirroring the bell's routing. */
function routeForIndividual(
  row: IndividualPushRow,
  meta: Record<string, unknown>
): string {
  if (row.type === 'COMMENT_REPLY') {
    const eventId = textOf(meta.eventId)
    if (eventId) {
      return row.targetId
        ? `/events/${eventId}#comment-${row.targetId}`
        : `/events/${eventId}`
    }
    return '/'
  }
  if (row.type === 'ADMIN_MESSAGE' || row.type === 'CHAT_MESSAGE') {
    const chatId = textOf(meta.chatId)
    return chatId ? `/messages?chat=${chatId}` : '/messages'
  }
  if (row.type === 'PASSWORD_RESET' || row.type === 'PASSWORD_ADVICE') {
    return '/profile'
  }
  if (row.targetType === 'EVENT' && row.targetId) return `/events/${row.targetId}`
  if (row.targetType === 'CHAT') return '/messages'
  return '/'
}

/** Sends one broadcast to every user the bell would show it to. */
async function pushBroadcast(
  row: { id: string; type: string; sourceType: string; sourceId: string; title: string; message: string | null },
  input: BroadcastInput
): Promise<void> {
  if (!isPushConfigured()) return

  const recipients = (await broadcastRecipients(input)).slice(0, MAX_PUSH_RECIPIENTS)
  if (recipients.length === 0) return

  const meta = recordOf(input.meta)
  const message = plainText(row.message)
  let body = message
  if (row.type === 'EVENT_CREATED' || row.type === 'EVENT_REMINDER') {
    body = message || row.title
  } else if (row.type === 'ORGANIZER_UPDATE') {
    const updateTitle = textOf(meta.updateTitle)
    body = [updateTitle, message].filter(Boolean).join(': ') || row.title
  } else if (row.type === 'ANNOUNCEMENT') {
    body = message || 'Open the app to see it.'
  }

  await sendPushToUserIds(recipients, {
    title: BROADCAST_TITLES[row.type] ?? row.title ?? 'Event Invites',
    body,
    data: {
      kind: 'broadcast',
      broadcastId: row.id,
      type: row.type,
      route: row.sourceType === 'EVENT' ? `/events/${row.sourceId}` : '/#announcements',
    },
  })
}

/**
 * Who may see a broadcast, applied at push time: the publish state and time
 * window the event page enforces, the visibility tags the bell resolves per
 * viewer, and the participant list an organizer update is limited to. Only
 * accounts with a registered device are returned, since nobody else can receive
 * a push.
 */
async function broadcastRecipients(input: BroadcastInput): Promise<string[]> {
  const withDevices = (where: Prisma.UserWhereInput) =>
    prisma.user.findMany({
      where: { ...where, deviceTokens: { some: {} } },
      select: { id: true },
    })

  // An announcement is a banner ad: it appears for everyone.
  if (input.sourceType === 'BANNER_AD') {
    return (await withDevices({})).map((user) => user.id)
  }

  const event = await prisma.event.findUnique({
    where: { id: input.sourceId },
    select: {
      id: true,
      isPublished: true,
      dateTime: true,
      endsAt: true,
      afterStartPolicy: true,
      visibilityMode: true,
      visibleTags: { select: { id: true } },
    },
  })
  if (!event) return []
  // A broadcast the event page would not show is not pushed either.
  if (!event.isPublished || !isPubliclyVisibleNow(event)) return []

  if (input.type === 'ORGANIZER_UPDATE') {
    const registrations = await prisma.registration.findMany({
      where: { eventId: event.id },
      select: { userId: true },
    })
    return [...new Set(registrations.map((registration) => registration.userId))]
  }

  const tagIds = event.visibleTags.map((tag) => tag.id)

  if (event.visibilityMode === 'INCLUDE') {
    // An INCLUDE event with no tags is visible to nobody.
    if (tagIds.length === 0) return []
    return (
      await withDevices({
        OR: [{ role: { in: ADMIN_ROLES } }, { tags: { some: { id: { in: tagIds } } } }],
      })
    ).map((user) => user.id)
  }

  if (event.visibilityMode === 'EXCLUDE') {
    return (
      await withDevices({
        OR: [{ role: { in: ADMIN_ROLES } }, { tags: { none: { id: { in: tagIds } } } }],
      })
    ).map((user) => user.id)
  }

  return (await withDevices({})).map((user) => user.id)
}

/** HTML out of a message body, as FCM only shows plain text. */
function plainText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** An object if the value is one, an empty record otherwise. */
function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/* ------------------------------- reminders -------------------------------- */

/** How soon an event is worth a reminder. */
const REMINDER_HORIZON_HOURS = 48

/** Remembered reminders survive a cleared log and a restarted process. */
const reminderKey = (eventId: string) => `reminded:${eventId}`

/**
 * Writes a reminder for each event that has come inside the horizon and has
 * not been reminded yet. Generated on read, like the upcoming-event log
 * entries, so no scheduled job is needed.
 */
export async function ensureEventReminders(): Promise<void> {
  const now = new Date()
  const horizon = new Date(now.getTime() + REMINDER_HORIZON_HOURS * 3600_000)

  const events = await prisma.event.findMany({
    where: { isPublished: true, dateTime: { gt: now, lte: horizon } },
    select: { id: true, title: true, dateTime: true },
    orderBy: { dateTime: 'asc' },
    take: 50,
  })
  if (events.length === 0) return

  const announced = await prisma.broadcastNotification.findMany({
    where: { type: 'EVENT_REMINDER', sourceId: { in: events.map((e) => e.id) } },
    select: { sourceId: true },
  })
  const already = new Set(announced.map((a) => a.sourceId))

  for (const event of events) {
    if (already.has(event.id)) continue
    const marker = await prisma.setting.findUnique({
      where: { key: reminderKey(event.id) },
      select: { key: true },
    })
    if (marker) continue
    await createBroadcast({
      type: 'EVENT_REMINDER',
      sourceType: 'EVENT',
      sourceId: event.id,
      title: event.title,
      meta: { startsAt: event.dateTime.toISOString() },
    })
    await prisma.setting.upsert({
      where: { key: reminderKey(event.id) },
      update: { value: '1' },
      create: { key: reminderKey(event.id), value: '1' },
    })
  }
}

/* -------------------------------- listing --------------------------------- */

/** One broadcast as the viewer sees it. */
export interface BroadcastView {
  id: string
  type: BroadcastType
  sourceType: string
  sourceId: string
  title: string
  message: string | null
  meta: Record<string, unknown> | null
  createdAt: string
  readAt: string | null
}

/** One individual notification as its owner sees it. */
export interface NotificationView {
  id: string
  type: NotificationType
  title: string
  message: string | null
  targetType: string | null
  targetId: string | null
  meta: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

/** How many of each the caller may keep. */
const MAX_BROADCASTS = 100
const MAX_INDIVIDUAL = 200

/**
 * Everything the viewer is allowed to see, newest first, with unread
 * counts. Broadcast eligibility is the same set of rules the event page
 * applies: publish state, the time window and the visibility tags, with an
 * administrator seeing drafts as well. An organizer update only reaches
 * users registered for its event.
 */
export async function listForUser(userId: string): Promise<{
  broadcasts: BroadcastView[]
  individual: NotificationView[]
  unreadBroadcasts: number
  unreadIndividual: number
}> {
  await ensureEventReminders()

  const viewer = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true },
  })

  const rows = await prisma.broadcastNotification.findMany({
    orderBy: { createdAt: 'desc' },
    take: MAX_BROADCASTS,
  })

  // Hidden for this user: a broadcast that was deleted stays invisible.
  const receipts = rows.length
    ? await prisma.broadcastReceipt.findMany({
        where: { userId, broadcastId: { in: rows.map((r) => r.id) } },
      })
    : []
  const receiptById = new Map(receipts.map((r) => [r.broadcastId, r]))

  const eventSources = [
    ...new Set(
      rows
        .filter((r) => r.sourceType === 'EVENT')
        .map((r) => r.sourceId)
    ),
  ]
  const events = eventSources.length
    ? await prisma.event.findMany({
        where: { id: { in: eventSources } },
        select: {
          id: true,
          isPublished: true,
          dateTime: true,
          endsAt: true,
          afterStartPolicy: true,
          visibilityMode: true,
          visibleTags: { select: { id: true } },
        },
      })
    : []
  const eventById = new Map(events.map((e) => [e.id, e]))

  // Organizer updates are only for participants of the event they belong to.
  const updateEventIds = [
    ...new Set(
      rows
        .filter((r) => r.type === 'ORGANIZER_UPDATE' && r.sourceType === 'EVENT')
        .map((r) => r.sourceId)
    ),
  ]
  const registered = updateEventIds.length
    ? await prisma.registration.findMany({
        where: { userId, eventId: { in: updateEventIds } },
        select: { eventId: true },
      })
    : []
  const registeredEventIds = new Set(registered.map((r) => r.eventId))

  // An announcement is a banner ad: it stays as long as the ad shows.
  const announcementIds = [
    ...new Set(
      rows
        .filter((r) => r.type === 'ANNOUNCEMENT' && r.sourceType === 'BANNER_AD')
        .map((r) => r.sourceId)
    ),
  ]
  const ads = announcementIds.length
    ? await prisma.bannerAd.findMany({
        where: { id: { in: announcementIds } },
        select: { id: true, isActive: true, slot: { select: { isActive: true } } },
      })
    : []
  const adById = new Map(ads.map((a) => [a.id, a]))

  const viewerRole = viewer?.role
  const isAdmin = atLeast(viewerRole, 'ADMIN')
  // Several broadcasts can point at one event; the visibility answer is the
  // same for all of them.
  const visibility = new Map<string, boolean>()
  const visibleForViewer = async (eventId: string): Promise<boolean> => {
    const cached = visibility.get(eventId)
    if (cached !== undefined) return cached
    const event = eventById.get(eventId)
    if (!event) return false
    const answer =
      isAdmin || // an administrator sees everything, drafts included
      ((await isEventVisibleTo(event, viewer ?? undefined)) &&
        event.isPublished &&
        isPubliclyVisibleNow(event))
    visibility.set(eventId, answer)
    return answer
  }

  const broadcasts: BroadcastView[] = []
  let unreadBroadcasts = 0

  for (const row of rows) {
    const receipt = receiptById.get(row.id)
    // A deleted broadcast stays deleted for this user.
    if (receipt?.hiddenAt) continue

    if (row.type === 'ANNOUNCEMENT') {
      const ad = adById.get(row.sourceId)
      if (!ad || !ad.isActive || !ad.slot.isActive) continue
    } else if (row.sourceType === 'EVENT') {
      const event = eventById.get(row.sourceId)
      // The event being deleted takes its notifications with it, so a
      // missing one cannot be shown.
      if (!event) continue
      if (row.type === 'ORGANIZER_UPDATE') {
        if (!registeredEventIds.has(event.id)) continue
      } else if (!(await visibleForViewer(event.id))) {
        continue
      }
    }

    const readAt = receipt?.readAt ?? null
    if (!readAt) unreadBroadcasts += 1
    broadcasts.push({
      id: row.id,
      type: row.type as BroadcastType,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      title: row.title,
      message: row.message,
      meta: row.meta ? safeParse(row.meta) : null,
      createdAt: row.createdAt.toISOString(),
      readAt: readAt ? readAt.toISOString() : null,
    })
  }

  const individualRows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: MAX_INDIVIDUAL,
  })
  const individual: NotificationView[] = individualRows.map((row) => ({
    id: row.id,
    type: row.type as NotificationType,
    title: row.title,
    message: row.message,
    targetType: row.targetType,
    targetId: row.targetId,
    meta: row.meta ? safeParse(row.meta) : null,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }))
  const unreadIndividual = individual.filter((n) => !n.readAt).length

  return { broadcasts, individual, unreadBroadcasts, unreadIndividual }
}

/* -------------------------------- actions --------------------------------- */

/** Marks a broadcast read. The receipt is created on demand. */
export async function markBroadcastRead(userId: string, id: string): Promise<void> {
  await prisma.broadcastReceipt.upsert({
    where: { broadcastId_userId: { broadcastId: id, userId } },
    update: { readAt: new Date() },
    create: { broadcastId: id, userId, readAt: new Date() },
  })
}

/**
 * Hides a broadcast for one user. The row itself stays: it leaves the system
 * only with the event or announcement it belongs to.
 */
export async function hideBroadcast(userId: string, id: string): Promise<void> {
  await prisma.broadcastReceipt.upsert({
    where: { broadcastId_userId: { broadcastId: id, userId } },
    update: { hiddenAt: new Date() },
    create: { broadcastId: id, userId, hiddenAt: new Date() },
  })
}

/** Marks an individual notification read. */
export async function markNotificationRead(userId: string, id: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  })
}

/** Removes an individual notification for good. */
export async function deleteNotification(userId: string, id: string): Promise<void> {
  await prisma.notification.deleteMany({ where: { id, userId } })
}

/** Everything the viewer can see becomes read in one step. */
export async function markAllRead(userId: string): Promise<void> {
  const unread = await prisma.notification.findMany({
    where: { userId, readAt: null },
    select: { id: true },
    take: MAX_INDIVIDUAL,
  })
  if (unread.length > 0) {
    await prisma.notification.updateMany({
      where: { id: { in: unread.map((n) => n.id) } },
      data: { readAt: new Date() },
    })
  }

  const list = await listForUser(userId)
  for (const broadcast of list.broadcasts) {
    if (!broadcast.readAt) await markBroadcastRead(userId, broadcast.id)
  }
}

/** Never throws: a malformed payload simply comes back as null. */
function safeParse(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}
