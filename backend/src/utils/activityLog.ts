import { prisma } from './prisma'
import type { ActivityCategory } from './validation'

/** Categories, in the order the filter row shows them. */
export const ACTIVITY_CATEGORIES: ActivityCategory[] = [
  'REGISTRATION',
  'GUEST_APPROVAL',
  'PASSWORD_RESET',
  'EVENT_CREATED',
  'EVENT_UPCOMING',
  'COMMENT',
  'COMMENT_REPLY',
  'BANNER',
  'FEEDBACK',
]

/** Setting key controlling whether new comments are logged. */
export const COMMENT_LOG_SETTING = 'log_comments'

export interface ActivityInput {
  category: ActivityCategory
  /** Who performed the action; null for entries the system generated. */
  actorId?: string | null
  actorName?: string | null
  /** What the entry is about: EVENT, COMMENT, BANNER or USER. */
  targetType?: string | null
  targetId?: string | null
  targetName?: string | null
  /** Short summary, such as the beginning of a comment. */
  detail?: string | null
  /** Feedback message body, already sanitized. */
  message?: string | null
  /** JSON payload for the entry's extras, e.g. an attachment. */
  meta?: unknown
}

/**
 * Writes one entry. Logging is best effort on purpose: a failure here must
 * never turn a successful user action into an error response, so it is
 * reported and the request carries on.
 */
export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        category: input.category,
        actorId: input.actorId ?? null,
        actorName: input.actorName ?? null,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        targetName: input.targetName ?? null,
        detail: input.detail ?? null,
        message: input.message ?? null,
        meta: input.meta === undefined || input.meta === null
          ? null
          : JSON.stringify(input.meta),
      },
    })
  } catch (err) {
    console.error('[activity] failed to write entry', err)
  }
}

/** Reads one setting; `false` when it has never been written. */
async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  return row?.value ?? null
}

/**
 * The actor's display name. The session token deliberately carries only the
 * id, so an entry that credits a user looks the name up on the way in.
 */
export async function actorName(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true },
  })
  return user?.name ?? null
}

/** New comments are logged only once an administrator turns it on. */
export async function areCommentsLogged(): Promise<boolean> {
  return (await readSetting(COMMENT_LOG_SETTING)) === '1'
}

export async function setCommentsLogged(value: boolean): Promise<void> {
  await prisma.setting.upsert({
    where: { key: COMMENT_LOG_SETTING },
    update: { value: value ? '1' : '0' },
    create: { key: COMMENT_LOG_SETTING, value: value ? '1' : '0' },
  })
}

/** How soon an event is announced in the log as upcoming. */
const UPCOMING_HORIZON_HOURS = 48

/**
 * A remembered announcement. Clearing the log empties the entries, but an
 * event that was already announced must not be announced a second time,
 * so the fact is kept beside the log rather than inside it.
 */
const announcementKey = (eventId: string) => `upcoming_announced:${eventId}`

async function wasAnnounced(eventId: string): Promise<boolean> {
  const marker = await prisma.setting.findUnique({
    where: { key: announcementKey(eventId) },
    select: { key: true },
  })
  if (marker) return true
  // Entries written before this marker existed are honoured too.
  const entry = await prisma.activityLog.findFirst({
    where: { category: 'EVENT_UPCOMING', targetId: eventId },
    select: { id: true },
  })
  return Boolean(entry)
}

/**
 * An "upcoming event" entry is written the first time an event falls inside
 * the horizon. Generating them here, rather than with a scheduled job, keeps
 * every deployment shape simple and still announces each event exactly once.
 */
export async function ensureUpcomingEventEntries(): Promise<void> {
  const now = new Date()
  const horizon = new Date(now.getTime() + UPCOMING_HORIZON_HOURS * 3600_000)

  const events = await prisma.event.findMany({
    where: { isPublished: true, dateTime: { gt: now, lte: horizon } },
    select: { id: true, title: true, dateTime: true },
    orderBy: { dateTime: 'asc' },
    take: 50,
  })
  if (events.length === 0) return

  const announced = await prisma.activityLog.findMany({
    where: { category: 'EVENT_UPCOMING', targetId: { in: events.map((e) => e.id) } },
    select: { targetId: true },
  })
  const alreadyInLog = new Set(announced.map((a) => a.targetId))

  for (const event of events) {
    if (alreadyInLog.has(event.id)) {
      // An entry that predates the marker adopts one, so a later clear does
      // not make the same event look unannounced.
      await rememberAnnouncement(event.id)
      continue
    }
    if (await wasAnnounced(event.id)) continue
    await logActivity({
      category: 'EVENT_UPCOMING',
      targetType: 'EVENT',
      targetId: event.id,
      targetName: event.title,
      detail: event.dateTime.toISOString(),
    })
    await rememberAnnouncement(event.id)
  }
}

/** Records that an event's upcoming announcement has been made. */
async function rememberAnnouncement(eventId: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: announcementKey(eventId) },
    update: { value: '1' },
    create: { key: announcementKey(eventId), value: '1' },
  })
}
