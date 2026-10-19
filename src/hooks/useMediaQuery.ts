import { useEffect, useState } from 'react'

/**
 * Tracks a CSS media query, e.g. '(orientation: portrait)'.
 *
 * Starts false so the server render and the first client render match;
 * the real value is adopted in an effect right after mount and then kept
 * in sync whenever the query's result changes.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const mql = window.matchMedia(query)
    const update = () => setMatches(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [query])

  return matches
}
