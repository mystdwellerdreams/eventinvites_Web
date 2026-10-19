import { useMemo } from 'react'
import type { AnchorHTMLAttributes, ReactNode } from 'react'
import {
  Link as RouterLink,
  useLocation,
  useNavigate,
  useParams as useRouterParams,
} from 'react-router-dom'

/**
 * The Next-shaped navigation surface, for the bundled app build.
 *
 * `mobile/vite.config.ts` aliases both `next/link` and `next/navigation` to
 * this one file, so every component keeps its existing imports and its
 * existing call sites. The Next build never loads it: it resolves the real
 * modules instead. That is what keeps one `src/` serving two builds without a
 * second copy of the navigation code.
 *
 * Only the parts the app actually uses are implemented. `refresh` and
 * `prefetch` exist so a Next call site type-checks and runs; React Router has
 * no equivalent, and the app never depends on either having an effect.
 */

/** The props `next/link` is used with in this codebase. */
interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  children?: ReactNode
}

/**
 * `next/link`'s default export: an anchor that routes client-side. `href`
 * carries the query string and hash the Next version accepts, and React Router
 * parses both out of the same string.
 */
export default function Link({ href, ...rest }: LinkProps) {
  return <RouterLink to={href} {...rest} />
}

/** What `useRouter()` returns, matching the calls the app makes. */
export interface AppRouter {
  push: (url: string) => void
  replace: (url: string) => void
  back: () => void
  refresh: () => void
  prefetch: () => void
}

/**
 * `next/navigation`'s `useRouter`. The second options argument Next accepts
 * (`{ scroll: false }`) is ignored: React Router restores its own scroll
 * position, and the app's own scroll handling lives in `main.tsx`.
 */
export function useRouter(): AppRouter {
  const navigate = useNavigate()
  return useMemo(
    () => ({
      push: (url: string) => navigate(url),
      replace: (url: string) => navigate(url, { replace: true }),
      back: () => navigate(-1),
      refresh: () => undefined,
      prefetch: () => undefined,
    }),
    [navigate]
  )
}

/** `next/navigation`'s `usePathname`. */
export function usePathname(): string {
  return useLocation().pathname
}

/** `next/navigation`'s `useParams`, which returns the same `{ id }` shape. */
export function useParams<
  T extends Record<string, string | undefined> = Record<string, string | undefined>,
>(): T {
  return useRouterParams() as T
}
