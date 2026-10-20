import type { CookieOptions } from 'express'
import { envValue } from './env'

/**
 * Origins the API is allowed to serve credentials to.
 *
 * Explicit only. Reflecting the request origin with `credentials: true` would
 * let any site make authenticated calls and read the responses, so when this
 * is unset no CORS headers are emitted at all.
 */
export function allowedOrigins(): string[] {
  const configured = (envValue('FRONTEND_URL') ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean)
  return configured
}

/**
 * True when the frontend is served from a different site, which is the case
 * for two Vercel projects: `vercel.app` is on the Public Suffix List, so
 * `app.vercel.app` and `api.vercel.app` are cross-site rather than
 * same-site.
 *
 * SameSite=None is then required for the auth cookies to be sent at all, and
 * browsers only accept such cookies over HTTPS.
 */
export function isCrossSiteDeployment(): boolean {
  const override = envValue('COOKIE_SAME_SITE')?.toLowerCase()
  if (override === 'none' || override === 'lax' || override === 'strict') {
    return override === 'none'
  }
  if (envValue('CROSS_SITE_AUTH') === 'true') return true
  if (envValue('CROSS_SITE_AUTH') === 'false') return false
  return process.env.NODE_ENV === 'production' && allowedOrigins().length > 0
}

/**
 * Cookie attributes shared by every set and clear, so a deletion always
 * matches the cookie it is removing. Mismatched SameSite or Secure attributes
 * leave the original cookie in place.
 */
export function cookieOptions(maxAge?: number): CookieOptions {
  const crossSite = isCrossSiteDeployment()
  return {
    httpOnly: true,
    // SameSite=None is rejected by browsers unless Secure is also set.
    secure: crossSite || process.env.NODE_ENV === 'production',
    sameSite: crossSite ? 'none' : 'lax',
    path: '/',
    ...(maxAge !== undefined ? { maxAge } : {}),
  }
}

/** Clears a cookie using the same attributes it was set with. */
export function clearCookie(res: import('express').Response, name: string): void {
  res.clearCookie(name, cookieOptions())
}