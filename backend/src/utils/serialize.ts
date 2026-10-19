import { coerceSocialLinks, type SocialLink } from './socialPlatforms'

export function parseJsonField<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function serializeJsonField(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  return JSON.stringify(value)
}

type WithUserJson = {
  socialLinks?: string | null
  [key: string]: unknown
}

/**
 * Normalises the stored social links to the current list shape, transparently
 * upgrading the legacy fixed-key object.
 */
export function withParsedUserJson<T extends WithUserJson>(user: T): T & { socialLinks: SocialLink[] } {
  const raw = parseJsonField<unknown>(user.socialLinks, null)
  return {
    ...user,
    socialLinks: coerceSocialLinks(raw),
  }
}

type WithEventJson = {
  pageStyle?: string | null
  layout?: string | null
  [key: string]: unknown
}

export function withParsedEventJson<T extends WithEventJson>(event: T) {
  return {
    ...event,
    pageStyle: parseJsonField(event.pageStyle, null),
    layout: parseJsonField(event.layout, null),
  }
}

export function withParsedEventListJson<T extends WithEventJson>(events: T[]) {
  return events.map(withParsedEventJson)
}

export function withParsedUserListJson<T extends WithUserJson>(users: T[]) {
  return users.map(withParsedUserJson)
}
