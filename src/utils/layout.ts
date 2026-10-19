import type { ElementType, LayoutElement } from '../types'

/** Elements an administrator can place on an event page. The title, date and
 *  time are not listed: they always render in the page header. */
export const ELEMENT_LABELS: Record<ElementType, string> = {
  coverImage: 'Cover Image',
  description: 'Detailed Description',
  address: 'Address',
  host: 'Hosts',
  price: 'Price',
  contactInfo: 'Organizer Contact',
  lists: 'Participant Lists',
  publicTags: 'Public Tags',
}

export const ELEMENT_TYPES = Object.keys(ELEMENT_LABELS) as ElementType[]

export const isElementType = (value: unknown): value is ElementType =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ELEMENT_LABELS, value)

export function defaultLayout(): LayoutElement[] {
  return [
    { id: 'coverImage', type: 'coverImage', order: 0, span: 2 },
    { id: 'description', type: 'description', order: 1, span: 2 },
    { id: 'address', type: 'address', order: 2, span: 1 },
    { id: 'host', type: 'host', order: 3, span: 1 },
    { id: 'price', type: 'price', order: 4, span: 1 },
    { id: 'contactInfo', type: 'contactInfo', order: 5, span: 1 },
    { id: 'lists', type: 'lists', order: 6, span: 2 },
  ]
}

/**
 * Drops anything the current version does not understand (for example entries
 * written by an older schema), then normalises order and span.
 */
export function sanitizeLayout(stored: unknown): LayoutElement[] {
  if (!Array.isArray(stored)) return []
  const seen = new Set<string>()
  return stored
    .filter((el): el is LayoutElement => {
      if (!el || !isElementType(el.type) || seen.has(el.type)) return false
      seen.add(el.type)
      return true
    })
    .sort((a, b) => a.order - b.order)
    .map((el, index) => ({ ...el, order: index, span: el.span === 2 ? 2 : 1 }))
}
