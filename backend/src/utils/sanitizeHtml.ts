/**
 * Allowlist HTML sanitizer for the event description.
 *
 * The description is authored in a rich-text editor and rendered with
 * `dangerouslySetInnerHTML`, so it has to be stripped of anything executable
 * before it is stored. The strategy is deliberately conservative: elements in
 * a small allowlist survive with a filtered attribute set, known-dangerous
 * elements are removed together with their contents, and every other element
 * is unwrapped so its text is preserved but its markup is not.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'div', 'span',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small',
  'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'pre', 'code',
  'a',
])

/** Removed together with everything inside them. */
const DANGEROUS_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template',
  'form', 'input', 'button', 'select', 'option', 'textarea',
  'link', 'meta', 'base', 'svg', 'math', 'title', 'head',
])

/** Only these style properties may survive, and only on these elements. */
const ALLOWED_STYLE_PROPS = new Set([
  'color', 'background-color', 'font-size', 'font-weight', 'font-style',
  'font-family', 'text-align', 'text-decoration',
])

const STYLE_BEARING_TAGS = new Set(['span', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li'])

const SAFE_URL = /^(https?:|mailto:|tel:)/i

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function sanitizeStyle(value: string): string {
  const kept: string[] = []
  for (const declaration of value.split(';')) {
    const index = declaration.indexOf(':')
    if (index === -1) continue
    const prop = declaration.slice(0, index).trim().toLowerCase()
    const val = declaration.slice(index + 1).trim()
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue
    // Reject anything that could break out of the attribute or pull in code.
    if (!val || /[<>;"'()]/.test(val) || /url\s*\(|expression|javascript:/i.test(val)) continue
    kept.push(`${prop}: ${val}`)
  }
  return kept.join('; ')
}

function sanitizeAttributes(tag: string, raw: string): string {
  const out: string[] = []

  for (const match of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*'|[^\s"'`=<>]+)/g)) {
    const name = match[1].toLowerCase()
    const value = match[2].replace(/^["']|["']$/g, '').trim()

    // Never allow event handlers or anything not explicitly allowed.
    if (name.startsWith('on')) continue
    if (name === 'style') {
      if (!STYLE_BEARING_TAGS.has(tag)) continue
      const style = sanitizeStyle(value)
      if (style) out.push(`style="${escapeText(style)}"`)
      continue
    }
    if (tag === 'a') {
      if (name === 'href') {
        if (!SAFE_URL.test(value)) continue
        out.push(`href="${escapeText(value)}"`)
        continue
      }
      if (name === 'target') {
        out.push('target="_blank"')
        continue
      }
      if (name === 'rel') {
        out.push('rel="noopener noreferrer"')
        continue
      }
    }
  }

  return out.join(' ')
}

/**
 * @param html untrusted markup
 * @returns markup containing only allowlisted tags and attributes
 */
export function sanitizeHtml(html: unknown): string {
  if (typeof html !== 'string' || html.length === 0) return ''
  // Cap the payload so a pathological document cannot be stored.
  const input = html.slice(0, 200_000)

  let result = ''
  let index = 0

  while (index < input.length) {
    const lt = input.indexOf('<', index)
    if (lt === -1) {
      result += escapeText(input.slice(index))
      break
    }
    if (lt > index) result += escapeText(input.slice(index, lt))

    // Comments and doctypes are dropped entirely.
    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4)
      index = end === -1 ? input.length : end + 3
      continue
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      const end = input.indexOf('>', lt)
      index = end === -1 ? input.length : end + 1
      continue
    }

    const gt = input.indexOf('>', lt)
    if (gt === -1) {
      result += escapeText(input.slice(lt))
      break
    }

    const inner = input.slice(lt + 1, gt)
    const closing = inner.startsWith('/')
    const nameMatch = inner.match(/^\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/)
    const tag = nameMatch ? nameMatch[1].toLowerCase() : ''

    if (!tag) {
      // Not a tag we can parse; treat the '<' as literal text.
      result += escapeText(input.slice(lt, gt + 1))
      index = gt + 1
      continue
    }

    if (DANGEROUS_TAGS.has(tag)) {
      if (closing) {
        index = gt + 1
      } else {
        // Skip the element and everything up to its matching close tag.
        const closeTag = `</${tag}`
        const end = input.toLowerCase().indexOf(closeTag, gt)
        index = end === -1 ? input.length : (input.indexOf('>', end) === -1 ? input.length : input.indexOf('>', end) + 1)
      }
      continue
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: drop the markup, keep the contents.
      index = gt + 1
      continue
    }

    if (closing) {
      result += `</${tag}>`
    } else {
      const selfClosing = /\/\s*$/.test(inner)
      const attrs = sanitizeAttributes(tag, inner)
      result += `<${tag}${attrs ? ' ' + attrs : ''}${selfClosing ? ' /' : ''}>`
    }
    index = gt + 1
  }

  return result
}

/** Plain text, for meta tags and previews. */
export function htmlToText(html: unknown): string {
  if (typeof html !== 'string') return ''
  return sanitizeHtml(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}
