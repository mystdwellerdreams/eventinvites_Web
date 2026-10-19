/**
 * Works out where the event page's back arrow should go.
 *
 * In-app navigation records the route it came from in `location.state.from`,
 * which is exact. Someone who opened the link directly (a shared event URL, a
 * refresh, a new tab) has no such state, so we fall back to the referring page
 * when it is one of ours, and to the event list when there is nothing to go
 * back to.
 */
export function resolveBackTarget(options: {
  from?: unknown
  pathname: string
  referrer: string
  canGoBack: boolean
}): string {
  const { from, pathname, referrer, canGoBack } = options

  if (typeof from === 'string' && from && from !== pathname) {
    return from
  }

  if (referrer) {
    try {
      const url = new URL(referrer)
      if (url.origin === window.location.origin) {
        const ref = `${url.pathname}${url.search}`
        if (ref && ref !== pathname) return ref
      }
    } catch {
      // Unparseable referrer; fall through to the history/default behaviour.
    }
  }

  // No usable in-app origin: rewind one history entry when there is one.
  return canGoBack ? pathname : '/'
}
