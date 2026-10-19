/**
 * Social networks a profile can link to, with the URL format each one expects.
 *
 * The user types a handle (a phone number, a username) rather than a URL, and
 * the link is built here so the stored value is always canonical. Custom links
 * keep whatever http(s) URL the user supplied.
 */

export const SOCIAL_PLATFORMS = [
  'whatsapp',
  'telegram',
  'instagram',
  'x',
  'facebook',
  'custom',
] as const

export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

export interface SocialLink {
  platform: SocialPlatform
  url: string
  /** Only used by `custom`, where the user names the link themselves. */
  label?: string
}

const handle = (raw: string): string =>
  raw
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(www\.)?[^/]+\//i, '')
    .replace(/\/+$/, '')
    .trim()

const digits = (raw: string): string => raw.replace(/\D+/g, '')

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Accepts either a bare handle or a full URL, and returns a canonical URL. */
function fromHandle(
  value: string,
  hosts: string[],
  normalise: (h: string) => string = (h) => h
): string | null {
  const raw = value.trim()
  if (!raw) return null

  if (isHttpUrl(raw)) {
    try {
      const url = new URL(raw)
      const host = url.hostname.toLowerCase().replace(/^www\./, '')
      const matched = hosts.some((h) => host === h || host.endsWith(`.${h}`))
      if (!matched) return null
      return url.toString()
    } catch {
      return null
    }
  }

  const cleaned = normalise(handle(raw))
  if (!cleaned || /[^\w.@-]/.test(cleaned)) return null
  return `https://${hosts[0]}/${cleaned}`
}

export interface SocialPlatformSpec {
  id: SocialPlatform
  label: string
  /** Short glyph shown in menus and link lists. */
  icon: string
  placeholder: string
  hint: string
  /** Whether a custom label is required. */
  needsLabel: boolean
  build: (value: string) => string | null
}

export const SOCIAL_PLATFORM_SPECS: Record<SocialPlatform, SocialPlatformSpec> = {
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: '💬',
    placeholder: '+1 555 0100',
    hint: 'A phone number with country code. We build wa.me for you.',
    needsLabel: false,
    build: (value) => {
      const phone = digits(value)
      if (phone.length < 7 || phone.length > 15) return null
      return `https://wa.me/${phone}`
    },
  },
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    icon: '✈️',
    placeholder: '@username',
    hint: 'Your Telegram username, with or without the @.',
    needsLabel: false,
    build: (value) => fromHandle(value, ['t.me', 'telegram.me']),
  },
  instagram: {
    id: 'instagram',
    label: 'Instagram',
    icon: '📷',
    placeholder: 'username',
    hint: 'Your Instagram username, with or without the @.',
    needsLabel: false,
    build: (value) => fromHandle(value, ['instagram.com']),
  },
  x: {
    id: 'x',
    label: 'X (Twitter)',
    icon: '✖️',
    placeholder: 'username',
    hint: 'Your X username, with or without the @.',
    needsLabel: false,
    build: (value) => fromHandle(value, ['x.com', 'twitter.com']),
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook',
    icon: '👤',
    placeholder: 'username or page',
    hint: 'Your Facebook username or page name.',
    needsLabel: false,
    build: (value) => fromHandle(value, ['facebook.com', 'fb.com']),
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    icon: '🔗',
    placeholder: 'https://example.com/me',
    hint: 'Any http(s) address, with a name of your choosing.',
    needsLabel: true,
    build: (value) => (isHttpUrl(value.trim()) ? value.trim() : null),
  },
}

export const isSocialPlatform = (value: unknown): value is SocialPlatform =>
  typeof value === 'string' && (SOCIAL_PLATFORMS as readonly string[]).includes(value)

/** Short display name for a stored link. */
export function socialLinkName(link: SocialLink): string {
  if (link.platform === 'custom') return link.label?.trim() || 'Website'
  return SOCIAL_PLATFORM_SPECS[link.platform]?.label ?? 'Link'
}

/**
 * The legacy shape was a fixed-key object ({ instagram: '…' }). It is still
 * read so existing profiles keep their links.
 */
export function coerceSocialLinks(raw: unknown): SocialLink[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((entry): SocialLink[] => {
      if (!entry || typeof entry !== 'object') return []
      const value = entry as Record<string, unknown>
      const platform = value.platform
      if (!isSocialPlatform(platform)) return []
      const url = typeof value.url === 'string' ? value.url.trim() : ''
      if (!url || !isHttpUrl(url)) return []
      const spec = SOCIAL_PLATFORM_SPECS[platform]
      // Custom links need a name; fall back to the host so nothing disappears.
      const label = typeof value.label === 'string' && value.label.trim() ? value.label.trim() : undefined
      return [{ platform, url, label: platform === 'custom' ? label ?? 'Website' : undefined }]
    })
  }

  if (raw && typeof raw === 'object') {
    const legacy = raw as Record<string, unknown>
    const out: SocialLink[] = []
    for (const [key, value] of Object.entries(legacy)) {
      if (typeof value !== 'string' || !value.trim() || !isHttpUrl(value.trim())) continue
      const platform = key === 'twitter' ? 'x' : key
      if (!isSocialPlatform(platform)) continue
      out.push({ platform, url: value.trim() })
    }
    return out
  }

  return []
}