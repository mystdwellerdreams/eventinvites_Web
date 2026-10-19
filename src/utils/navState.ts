/**
 * Carries values across a navigation.
 *
 * React Router passed state with `navigate(path, { state })`; the App Router
 * has no equivalent, so handoffs go through sessionStorage. That also survives
 * a refresh, which location.state did not.
 */

const PREFIX = 'event-invites:nav:'

/**
 * Key for the unsaved event preview the editor hands to the event page.
 * Shared so the writer and the reader cannot drift apart.
 */
export const EVENT_DRAFT_KEY = 'event-draft'

export function stashNavigation(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; navigation still works without the hint.
  }
}

/** Reads and removes a stashed value, so it is not reused later. */
export function takeNavigation<T>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key)
    if (raw === null) return undefined
    window.sessionStorage.removeItem(PREFIX + key)
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

/** Reads without removing, for values needed on first render. */
export function peekNavigation<T>(key: string): T | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.sessionStorage.getItem(PREFIX + key)
    return raw === null ? undefined : (JSON.parse(raw) as T)
  } catch {
    return undefined
  }
}