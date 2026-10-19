import type { ElementType, Event } from '../types'
import { defaultLayout, sanitizeLayout } from './layout'
import { eventEndsAt, eventStartsAt } from './eventTime'

/** Where the shared text goes: a chat app or the clipboard. */
export type ShareTarget = 'whatsapp' | 'telegram' | 'copy'

/**
 * The text shared from an event page.
 *
 * The title leads, then the date and time, the location,
 * the detailed description and the cost, followed by the
 * remaining page elements in the order set in "Page
 * Elements & Layout". The participant lists close the
 * text, above a blank line and the link to the event
 * page. WhatsApp and Telegram render the date and
 * location emoji; the copied text stays plain.
 */
export function buildEventShareText(
  event: Event,
  locale?: string,
  target: ShareTarget = 'copy'
): string {
  const emoji = target === 'whatsapp' || target === 'telegram'
  const lines: string[] = []

  if (event.title) lines.push(event.title)

  const startsAt = eventStartsAt(event)
  if (!Number.isNaN(startsAt.getTime())) {
    const endsAt = eventEndsAt(event)
    const range = endsAt ? ` – ${shareTime(endsAt, locale)}` : ''
    lines.push(
      `${emoji ? '📅 ' : ''}${shareDate(startsAt, locale)} ${shareTime(startsAt, locale)}${range}`
    )
  }

  if (event.address) lines.push(`${emoji ? '📍 ' : ''}${event.address}`)

  if (event.description) {
    const text = htmlToPlainText(event.description)
    if (text) lines.push(text)
  }

  const cost = shareCost(event)
  if (cost) lines.push(cost)

  // The remaining page elements, in the page's own order.
  // Location, detailed description and cost are placed
  // above; the participant lists close the text below.
  const stored = sanitizeLayout(event.layout)
  const layout = stored.length > 0 ? stored : defaultLayout()
  for (const element of layout) {
    const line = elementShareLine(element.type, event)
    if (line) lines.push(line)
  }

  // Each participant list: its name, then its
  // participants numbered, one list per block.
  const listBlocks = (event.lists ?? [])
    .map((list) => {
      const participants = (list.registrations ?? [])
        .map((registration) => registration.user?.name)
        .filter((name): name is string => Boolean(name))
      return [
        list.name,
        ...participants.map((name, index) => `${index + 1}. ${name}`),
      ].join('\n')
    })
    .filter((block) => block.length > 0)
  if (listBlocks.length > 0) lines.push(listBlocks.join('\n\n'))

  const url = eventPageUrl(event)
  if (url) lines.push('', url)

  return lines.join('\n')
}

/** One layout element as a single line of share text. */
function elementShareLine(type: ElementType, event: Event): string {
  switch (type) {
    // The cover image has no text form; the page link at
    // the end covers it. Location, detailed description
    // and cost are placed above; the participant lists
    // close the text.
    case 'coverImage':
    case 'description':
    case 'address':
    case 'price':
    case 'lists':
      return ''
    case 'host': {
      const hosts = event.hosts?.length
        ? event.hosts
        : event.host
          ? [event.host]
          : []
      return hosts.map((h) => h.name).filter(Boolean).join(', ')
    }
    case 'contactInfo': {
      if (event.contactMode === 'PROFILE') {
        const organizer = event.organizer
        if (!organizer) return ''
        return organizer.email
          ? `${organizer.name} (${organizer.email})`
          : organizer.name
      }
      return event.contactInfo ?? ''
    }
    case 'publicTags':
      return (event.publicTags ?? []).map((tag) => tag.name).join(', ')
  }
}

/**
 * The cost as one amount: the price plus every surcharge,
 * with the currency symbol to the right of the value.
 * Surcharges can only be added up when they all use the
 * event's currency; otherwise the base price stands on
 * its own.
 */
function shareCost(event: Event): string {
  const items = event.priceItems ?? []
  if (event.price == null && items.length === 0) return ''
  const currency = event.currency ?? '$'
  const base = event.price ?? 0
  const summable = items.every((item) => (item.currency ?? currency) === currency)
  const total = summable
    ? base + items.reduce((sum, item) => sum + (item.price ?? 0), 0)
    : base
  return total > 0 ? `${total.toFixed(2)}${currency}` : 'Free'
}

/** "Thu 19 Sep" — the short weekday, day and month, no year. */
function shareDate(date: Date, locale?: string): string {
  const weekday = date.toLocaleDateString(locale, { weekday: 'short' })
  const day = date.toLocaleDateString(locale, { day: 'numeric' })
  const month = date.toLocaleDateString(locale, { month: 'short' })
  return `${weekday} ${day} ${month}`
}

/** "14:00" — always the 24-hour clock. */
function shareTime(date: Date, locale?: string): string {
  return date.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

/**
 * The public address of an event page. The key URL is the stable
 * link the event editor shows, so it is the one worth sharing.
 */
export function eventPageUrl(event: Event): string {
  if (typeof window === 'undefined') return ''
  if (!event.key || event.key === 'draft') return ''
  return `${window.location.origin}/events/key/${event.key}`
}

/** WhatsApp's prefilled-message link. */
export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

/** Telegram's share-sheet link. */
export function telegramShareUrl(text: string, url: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(
    url
  )}&text=${encodeURIComponent(text)}`
}

/**
 * Plain text for the rich-text description: block elements become
 * line breaks, list items become bullets, every other tag is
 * unwrapped and the common entities are decoded.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:p|div|h[1-6]|blockquote|ul|ol)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}
