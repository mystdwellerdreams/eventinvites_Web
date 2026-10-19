import type { SocialPlatform, SocialLink } from '../types'

/**
 * The social networks a profile can link to, with the URL each expects.
 *
 * Mirrors `backend/src/utils/socialPlatforms.ts`: the user types a handle or
 * address and the link is built here for preview, then the server rebuilds and
 * validates it before storing.
 */

export interface SocialPlatformSpec {
  id: SocialPlatform
  label: string
  icon: string
  placeholder: string
  hint: string
  needsLabel: boolean
  build: (value: string) => string | null
}

const handle = (raw: string): string =>
  raw
    .trim()
    .replace(/^@+/, '')
    .replace(/^https?:\/\/(www\.)?[^/]+\//i, '')
    .replace(/\/+$/, '')
    .trim()

const isHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function fromHandle(value: string, hosts: string[]): string | null {
  const raw = value.trim()
  if (!raw) return null
  if (isHttpUrl(raw)) {
    try {
      const url = new URL(raw)
      const host = url.hostname.toLowerCase().replace(/^www\./, '')
      if (!hosts.some((h) => host === h || host.endsWith(`.${h}`))) return null
      return url.toString()
    } catch {
      return null
    }
  }
  const cleaned = handle(raw)
  if (!cleaned || /[^\w.@-]/.test(cleaned)) return null
  return `https://${hosts[0]}/${cleaned}`
}

export const SOCIAL_PLATFORM_SPECS: Record<SocialPlatform, SocialPlatformSpec> = {
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: '💬',
    placeholder: '+1 555 0100',
    hint: 'A phone number with its country code. We build the wa.me link for you.',
    needsLabel: false,
    build: (value) => {
      const phone = value.replace(/\D+/g, '')
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

export const SOCIAL_PLATFORM_ORDER: SocialPlatform[] = [
  'whatsapp',
  'telegram',
  'instagram',
  'x',
  'facebook',
  'custom',
]

export function socialLinkName(link: SocialLink): string {
  if (link.platform === 'custom') return link.label?.trim() || 'Website'
  return SOCIAL_PLATFORM_SPECS[link.platform]?.label ?? 'Link'
}