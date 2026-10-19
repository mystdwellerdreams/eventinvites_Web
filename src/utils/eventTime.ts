/** The fields the timing helpers need, so a draft preview works the same way. */
export interface TimedEvent {
  dateTime: string
  durationMinutes?: number | null
  endsAt?: string | null
}

export type EventPhase = 'upcoming' | 'live' | 'ended'

const MINUTE = 60_000

/**
 * Formats dates in the chosen interface language. `undefined` uses the
 * browser's locale, which is what happens before a language is picked.
 */
type LocaleArg = string | undefined

export function eventStartsAt(event: TimedEvent): Date {
  return new Date(event.dateTime)
}

/**
 * The end of the event, or null when it has no timeframe. Falls back to
 * `dateTime + durationMinutes` so a draft that has not been saved yet, or a
 * row predating the stored `endsAt`, still resolves correctly.
 */
export function eventEndsAt(event: TimedEvent): Date | null {
  if (event.endsAt) return new Date(event.endsAt)
  const minutes = event.durationMinutes
  if (!minutes || minutes <= 0) return null
  return new Date(eventStartsAt(event).getTime() + minutes * MINUTE)
}

/** True only while the event is genuinely running: started, not yet finished. */
export function isEventLive(event: TimedEvent, now: Date = new Date()): boolean {
  const endsAt = eventEndsAt(event)
  if (!endsAt) return false
  const time = now.getTime()
  return eventStartsAt(event).getTime() <= time && endsAt.getTime() > time
}

export function eventPhase(event: TimedEvent, now: Date = new Date()): EventPhase {
  if (isEventLive(event, now)) return 'live'
  return now.getTime() < eventStartsAt(event).getTime() ? 'upcoming' : 'ended'
}

export function isRegistrationOpen(event: TimedEvent, now: Date = new Date()): boolean {
  return eventPhase(event, now) === 'upcoming'
}

/** "1 h 30 min", "45 min", "2 days" - used for the duration control. */
export function formatDuration(totalMinutes: number | null | undefined): string {
  if (!totalMinutes || totalMinutes <= 0) return ''
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  const parts: string[] = []
  if (days) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  if (minutes) parts.push(`${minutes} min`)

  return parts.join(' ')
}

/** Splits a duration into the hours/minutes pair the editor edits. */
export function splitDuration(totalMinutes: number | null | undefined) {
  const minutes = totalMinutes && totalMinutes > 0 ? totalMinutes : 0
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 }
}

export function joinDuration(hours: number, minutes: number): number {
  const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0)
  return total > 0 ? total : 0
}

export function formatEventTimeRange(event: TimedEvent, locale?: LocaleArg): string {
  const start = eventStartsAt(event)
  const endsAt = eventEndsAt(event)
  if (!endsAt) {
    return start.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  const sameDay = start.toDateString() === endsAt.toDateString()
  const time = (d: Date) => d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  return sameDay
    ? `${time(start)} – ${time(endsAt)}`
    : `${time(start)} – ${endsAt.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}`
}
