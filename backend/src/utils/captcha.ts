import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../middleware/errorHandler'

/** Where Cloudflare answers a Turnstile token. */
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** How long the verification call may take before it counts as failed. */
const VERIFY_TIMEOUT_MS = 8000
/** How long a fallback token stays good for. */
const FALLBACK_TOKEN_TTL_MS = 10 * 60 * 1000
/** Marks a token issued by this app's own fallback rather than Cloudflare. */
const FALLBACK_TOKEN_PREFIX = 'fb1.'

/** The header a verified challenge travels in. A header rather than a body
 *  field so the same call works for JSON and for multipart uploads. */
export const CAPTCHA_HEADER = 'x-captcha-token'

export interface CaptchaResult {
  ok: boolean
  /** Cloudflare's own reason codes, for the log. */
  reasons: string[]
}

/**
 * Whether a secret is configured. Without one the app runs without
 * verification — the local development and preview path — and every check
 * passes through with a warning rather than locking everyone out.
 */
export function captchaEnabled(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY)
}

/** The signing key for this app's own fallback tokens. */
function fallbackSecret(): string {
  return process.env.CAPTCHA_SECRET || process.env.JWT_SECRET || 'insecure-development-only'
}

/** Signs `payload` so a fallback token cannot be forged by the client. */
function sign(payload: string): string {
  return crypto.createHmac('sha256', fallbackSecret()).update(payload).digest('base64url')
}

let warnedAboutMissingSecret = false

/**
 * Asks Cloudflare whether a challenge token is genuine. A token is
 * single-use, so every protected action presents a freshly verified one.
 *
 * `action` names what the token was issued for, and a token minted by this
 * app's own fallback is only good for that action — otherwise one cleared
 * challenge could be replayed to clear another.
 *
 * The answer is never guessed at: a network failure to Cloudflare, a
 * timeout, or a malformed body all count as "not verified" rather than
 * silently letting the request through.
 */
export async function verifyCaptcha(
  token: string | undefined,
  remoteIp?: string,
  action?: string
): Promise<CaptchaResult> {
  if (token?.startsWith(FALLBACK_TOKEN_PREFIX)) {
    // This app's own fallback token: verified here, without a call out.
    const ok = verifyFallbackToken(token, action)
    return { ok, reasons: ok ? [] : ['fallback-token-invalid'] }
  }

  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    if (!warnedAboutMissingSecret) {
      warnedAboutMissingSecret = true
      console.warn(
        '[captcha] TURNSTILE_SECRET_KEY is not set: challenges are accepted without verification. Local development only.'
      )
    }
    return { ok: true, reasons: ['not-configured'] }
  }

  if (!token) {
    return { ok: false, reasons: ['missing-token'] }
  }

  const body = new URLSearchParams({ secret, response: token })
  if (remoteIp) body.set('remoteip', remoteIp)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS)
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    })
    const result = (await response.json()) as {
      success?: boolean
      'error-codes'?: string[]
    }
    return {
      ok: result.success === true,
      reasons: result['error-codes'] ?? [],
    }
  } catch (err) {
    // Cloudflare being unreachable is a failure of the check, not a pass.
    console.error(
      '[captcha] verification call failed:',
      err instanceof Error ? err.message : err
    )
    return { ok: false, reasons: ['verification-unavailable'] }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------- the app's own fallback ------------------------- */

/**
 * The fallback for when the Cloudflare widget cannot load — the script is
 * blocked, or the connection to it is gone. The server poses the question
 * and signs it, so the challenge cannot be solved by simply claiming to
 * have solved it: the answer is checked against what the server asked.
 */
export function issueFallbackChallenge(): { id: string; question: string } {
  const a = crypto.randomInt(2, 9)
  const b = crypto.randomInt(2, 9)
  const payload = `${a}+${b}:${Date.now()}`
  // The id carries the question and the signature that proves this server
  // asked it; tampering with the numbers invalidates the signature.
  return {
    id: `${Buffer.from(payload, 'utf8').toString('base64url')}.${sign(payload)}`,
    question: `${a} + ${b} = ?`,
  }
}

/** Checks an answer against the signed challenge it belongs to. */
export function answerFallback(id: string, answer: string): boolean {
  const [encoded, signature] = id.split('.')
  if (!encoded || !signature) return false
  const payload = Buffer.from(encoded, 'base64url').toString('utf8')
  if (!payload || sign(payload) !== signature) return false
  const match = /^(\d+)\+(\d+):/.exec(payload)
  if (!match) return false
  const expected = Number(match[1]) + Number(match[2])
  return Number(answer.trim()) === expected
}

/** Mints a token this app can verify without calling Cloudflare. */
export function mintFallbackToken(action: string): string {
  const expires = Date.now() + FALLBACK_TOKEN_TTL_MS
  const payload = `${action}.${expires}`
  return `${FALLBACK_TOKEN_PREFIX}${payload}.${sign(payload)}`
}

/** Whether a fallback token is genuine and still in its window. */
export function verifyFallbackToken(token: string, action?: string): boolean {
  const [prefix, act, expires, signature] = token.split('.')
  if (prefix !== FALLBACK_TOKEN_PREFIX.slice(0, -1)) return false
  if (action && act !== action) return false
  if (Number(expires) < Date.now()) return false
  return sign(`${act}.${expires}`) === signature
}

/**
 * Route middleware factory: the action this request performs must present a
 * verified challenge issued for it. Placed after the body parser, so the
 * token is read from the header and the body is left untouched.
 */
export function requireCaptcha(action: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers[CAPTCHA_HEADER]
    const token = Array.isArray(header) ? header[0] : header
    const ip =
      (req.headers['cf-connecting-ip'] as string | undefined) ??
      req.socket?.remoteAddress

    void verifyCaptcha(token, ip, action)
      .then((result) => {
        if (result.ok) {
          next()
          return
        }
        // The reasons go to the log, where they are useful; the client is
        // told only that the check did not pass, so nothing about the
        // verification itself is leaked.
        console.warn(`[captcha] challenge rejected: ${result.reasons.join(', ') || 'unknown'}`)
        next(new AppError(400, 'The security check did not pass. Please try the challenge again.', 'CAPTCHA_FAILED'))
      })
      .catch(next)
  }
}
