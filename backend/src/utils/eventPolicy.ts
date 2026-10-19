import type { Prisma } from '../generated/prisma/client'

export const AFTER_START_POLICIES = [
  'UNPUBLISH_AT_START',
  'KEEP_PUBLISHED_LOCKED',
  'OPEN_AFTER_START',
] as const
export type AfterStartPolicy = (typeof AFTER_START_POLICIES)[number]

export const isAfterStartPolicy = (v: unknown): v is AfterStartPolicy =>
  typeof v === 'string' && (AFTER_START_POLICIES as readonly string[]).includes(v)

interface TimedEvent {
  dateTime: Date
  endsAt: Date | null
  afterStartPolicy: string
}

/** Registration closes at the end of the event, or at the start under every policy but OPEN_AFTER_START. */
export function registrationClosesAt(event: TimedEvent): Date {
  if (event.afterStartPolicy === 'OPEN_AFTER_START') {
    return event.endsAt ?? new Date(8.64e15)
  }
  return event.dateTime
}

export function isRegistrationBlockedByTime(event: TimedEvent, now: Date = new Date()): boolean {
  return registrationClosesAt(event).getTime() <= now.getTime()
}

/**
 * Which events the public may still see, given how the event behaves after it
 * starts. Time rules apply to everyone; only tag rules are bypassed for
 * administrators, which happens in `tagVisibilityFilter`.
 */
export function publishedVisibilityFilter(now: Date): Prisma.EventWhereInput {
  return {
    isPublished: true,
    OR: [
      // Still to come: listed under every policy.
      { dateTime: { gt: now } },
      // Started already, but the administrator asked for it to stay listed.
      // With no end time there is nothing to finish, so it simply remains.
      {
        afterStartPolicy: { in: ['KEEP_PUBLISHED_LOCKED', 'OPEN_AFTER_START'] },
        OR: [{ endsAt: { gt: now } }, { endsAt: null }],
      },
    ],
  }
}

/** True while the event is running: started, not yet over. */
export function isRunning(event: TimedEvent, now: Date = new Date()): boolean {
  if (!event.endsAt) return false
  return event.dateTime.getTime() <= now.getTime() && event.endsAt.getTime() > now.getTime()
}

/**
 * Whether the public may open this event's page right now.
 *
 * Mirrors `publishedVisibilityFilter` so that a direct link cannot be used to
 * reach an event the home page has already hidden.
 */
export function isPubliclyVisibleNow(
  event: { dateTime: Date; endsAt: Date | null; afterStartPolicy: string },
  now: Date = new Date()
): boolean {
  if (event.dateTime.getTime() > now.getTime()) return true
  return (
    event.afterStartPolicy === 'KEEP_PUBLISHED_LOCKED' ||
    event.afterStartPolicy === 'OPEN_AFTER_START'
  )
}
