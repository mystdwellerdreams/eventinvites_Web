/**
 * Phone numbers are the primary contact identifier, so they are stored twice:
 *
 * - `phone` is what we show back to people and what they typed, tidied up.
 * - `phoneKey` is digits only, so `+1 (555) 010-0`, `1-555-0100` and
 *   `+15550100` all resolve to the same account for login and uniqueness.
 */
export function normalizePhone(value: string | null | undefined): string {
  if (!value) return ''
  const trimmed = value.trim()
  const digits = trimmed.replace(/\D/g, '')
  if (!digits) return ''
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

export function phoneKey(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\D/g, '')
}

export function isValidPhone(value: string): boolean {
  const digits = phoneKey(value)
  return digits.length >= 6 && digits.length <= 20
}
