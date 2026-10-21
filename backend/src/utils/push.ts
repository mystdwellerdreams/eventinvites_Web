import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { prisma } from './prisma'
import { envValue } from './env'

/**
 * Delivers push notifications to the Android app through Firebase Cloud
 * Messaging (HTTP v1).
 *
 * Everything here is best-effort and off by default: with no service account
 * configured every call returns immediately, so a deployment that does not use
 * the mobile app behaves exactly as it did before. A failure to reach FCM is
 * logged and swallowed for the same reason a failed notification insert is —
 * a delivered action must not turn into an error because the push did not
 * leave the building.
 *
 * Configuration, in order of preference:
 *
 *   FCM_SERVICE_ACCOUNT_JSON - the service-account JSON, inline or base64.
 *   FIREBASE_SERVICE_ACCOUNT_JSON - an alias for the same value.
 *   GOOGLE_APPLICATION_CREDENTIALS - a path to the JSON file.
 *   FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY - the three fields.
 *
 * FCM_PROJECT_ID may also be set on its own to override the project named in
 * the service account.
 */

interface ServiceAccount {
  projectId: string
  clientEmail: string
  privateKey: string
}

/** One notification to deliver, already addressed to a user. */
export interface PushMessage {
  userId: string
  title: string
  body: string
  /** Everything the app needs to open the right screen and mark it read. */
  data?: Record<string, string | null | undefined>
}

/** One message as FCM expects it, once a device token is known. */
interface PushPayload {
  title: string
  body: string
  data: Record<string, string>
}

/** How many FCM requests run at once. One request carries one token. */
const CONCURRENCY = 20

/** FCM notification text is clamped so a long comment cannot bloat a push. */
const TITLE_LIMIT = 120
const BODY_LIMIT = 240

/** Android draws every notification through this channel, created by the app. */
export const PUSH_CHANNEL_ID = 'event_invites'

let account: ServiceAccount | null | undefined
let accessToken: { value: string; expiresAt: number } | null = null

/** Whether a service account is configured; push is a no-op without one. */
export function isPushConfigured(): boolean {
  return readAccount() !== null
}

/** Reads the service account once, from whichever source is set. */
function readAccount(): ServiceAccount | null {
  if (account !== undefined) return account

  const inline =
    envValue('FCM_SERVICE_ACCOUNT_JSON') || envValue('FIREBASE_SERVICE_ACCOUNT_JSON')

  let parsed: Record<string, unknown> | null = null

  if (inline) {
    parsed = parseJson(inline)
  } else if (envValue('GOOGLE_APPLICATION_CREDENTIALS')) {
    try {
      parsed = JSON.parse(readFileSync(envValue('GOOGLE_APPLICATION_CREDENTIALS') as string, 'utf8'))
    } catch (err) {
      console.error('[push] could not read GOOGLE_APPLICATION_CREDENTIALS', err)
    }
  } else if (envValue('FCM_CLIENT_EMAIL') && envValue('FCM_PRIVATE_KEY')) {
    parsed = {
      project_id: envValue('FCM_PROJECT_ID'),
      client_email: envValue('FCM_CLIENT_EMAIL'),
      private_key: envValue('FCM_PRIVATE_KEY'),
    }
  }

  const projectId =
    envValue('FCM_PROJECT_ID') ||
    (typeof parsed?.project_id === 'string' ? parsed.project_id : undefined)
  const clientEmail =
    typeof parsed?.client_email === 'string' ? parsed.client_email : undefined
  const privateKey =
    typeof parsed?.private_key === 'string' ? parsed.private_key : undefined

  account =
    projectId && clientEmail && privateKey
      ? { projectId, clientEmail, privateKey: privateKey.replace(/\\n/g, '\n') }
      : null

  if (account === null && (inline || envValue('FCM_PROJECT_ID'))) {
    console.warn(
      '[push] FCM configuration is incomplete. Push notifications are disabled.'
    )
  }

  return account
}

/**
 * Accepts raw JSON, a JSON document that was itself stringified, a copy
 * pasted by hand, or a base64-encoded copy of any of them.
 *
 * The stringified form is what a person ends up with when they copy the
 * account out of a console: `JSON.parse` on it succeeds and hands back a
 * string, so it has to be unwrapped and read again.
 */
function parseJson(value: string): Record<string, unknown> | null {
  const attempts = [value, repairJson(value), safeBase64(value)].filter(
    (candidate): candidate is string => Boolean(candidate)
  )
  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt)
      const unwrapped = typeof parsed === 'string' ? unwrapJson(parsed) : parsed
      if (unwrapped && typeof unwrapped === 'object') {
        return unwrapped as Record<string, unknown>
      }
    } catch {
      // Try the next form.
    }
  }
  return null
}

/**
 * Repairs a JSON document that was pasted into a single-line value.
 *
 * An environment variable holds one line, so a document copied out of a
 * console arrives with its newlines still in it — and a newline is not
 * allowed between JSON tokens. The quotes may also have been escaped by
 * hand. Putting the quotes back first makes it possible to tell the
 * newlines apart: the ones inside a string are the key's own line breaks and
 * have to stay escaped, and the ones between tokens are only whitespace.
 */
function repairJson(value: string): string {
  const unescaped = value.replace(/\\"/g, '"')
  let out = ''
  let inString = false
  for (const char of unescaped) {
    if (char === '"') {
      inString = !inString
      out += char
      continue
    }
    if (char === '\n' || char === '\r') {
      out += inString ? '\\n' : ' '
      continue
    }
    out += char
  }
  return out
}

/** Reads a JSON document that arrived as a string. */
function unwrapJson(value: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function safeBase64(value: string): string | null {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf8')
    return decoded.includes('{') ? decoded : null
  } catch {
    return null
  }
}

/**
 * An OAuth2 access token for the FCM scope, cached until shortly before it
 * expires. The grant is the standard service-account JWT flow, signed with the
 * account's private key so no extra dependency is needed.
 */
async function getAccessToken(current: ServiceAccount): Promise<string> {
  if (accessToken && accessToken.expiresAt - 60_000 > Date.now()) {
    return accessToken.value
  }

  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(
    JSON.stringify({
      iss: current.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  )

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  signer.end()
  const signature = signer.sign(current.privateKey).toString('base64url')
  const assertion = `${header}.${claims}.${signature}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  if (!response.ok) {
    throw new Error(`FCM token request failed (${response.status}): ${await response.text()}`)
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number }
  if (!body.access_token) {
    throw new Error('FCM token response had no access_token')
  }

  accessToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
  }
  return accessToken.value
}

/**
 * Sends one notification to each of several users' registered devices.
 *
 * Tokens are looked up once for the whole batch, so a support message to every
 * administrator costs one query rather than one per recipient.
 */
export async function sendPushToUserIds(
  userIds: string[],
  payload: PushPayload
): Promise<void> {
  const unique = [...new Set(userIds)].filter(Boolean)
  if (unique.length === 0) return

  const messages: PushMessage[] = unique.map((userId) => ({ userId, ...payload }))
  await sendPushMessages(messages)
}

/**
 * Sends each message to every device its user has registered. Nothing throws:
 * the caller is always inside a request that has already done its real work.
 */
export async function sendPushMessages(messages: PushMessage[]): Promise<void> {
  const current = readAccount()
  if (!current || messages.length === 0) return

  try {
    const tokens = await prisma.deviceToken.findMany({
      where: { userId: { in: messages.map((m) => m.userId) } },
      select: { token: true, userId: true },
    })
    if (tokens.length === 0) return

    const byUser = new Map<string, string[]>()
    for (const row of tokens) {
      const list = byUser.get(row.userId)
      if (list) list.push(row.token)
      else byUser.set(row.userId, [row.token])
    }

    const deliveries: { token: string; payload: PushPayload }[] = []
    for (const message of messages) {
      const userTokens = byUser.get(message.userId)
      if (!userTokens) continue
      const payload: PushPayload = {
        title: clamp(message.title, TITLE_LIMIT),
        body: clamp(message.body, BODY_LIMIT),
        data: cleanData(message.data),
      }
      for (const token of userTokens) deliveries.push({ token, payload })
    }
    if (deliveries.length === 0) return

    const token = await getAccessToken(current)
    await runBatched(deliveries, CONCURRENCY, (delivery) =>
      deliverOne(current.projectId, token, delivery.token, delivery.payload)
    )
  } catch (err) {
    console.error('[push] delivery failed', err)
  }
}

/** Posts one message, removing a token FCM no longer recognises. */
async function deliverOne(
  projectId: string,
  accessTokenValue: string,
  deviceToken: string,
  payload: PushPayload
): Promise<void> {
  const body = {
    message: {
      token: deviceToken,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      android: {
        priority: 'high',
        notification: {
          channel_id: PUSH_CHANNEL_ID,
          sound: 'default',
          default_vibrate_timings: true,
        },
      },
    },
  }

  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessTokenValue}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  )

  if (response.ok) return

  const text = await response.text().catch(() => '')
  // A token that is gone for good (uninstalled app, cleared data, expired) is
  // removed so it is not retried on every future notification.
  if (response.status === 404 || /UNREGISTERED|NOT_FOUND|not a valid FCM registration token/i.test(text)) {
    await prisma.deviceToken.deleteMany({ where: { token: deviceToken } }).catch(() => undefined)
    return
  }

  console.error(`[push] FCM rejected a message (${response.status}): ${text.slice(0, 300)}`)
}

/** Runs `worker` over `items` with a bounded number in flight at once. */
async function runBatched<T>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  for (let index = 0; index < items.length; index += size) {
    const chunk = items.slice(index, index + size)
    await Promise.allSettled(chunk.map((item) => worker(item)))
  }
}

/** FCM data values must be strings; empty ones are dropped. */
function cleanData(
  data: Record<string, string | null | undefined> | undefined
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!data) return out
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  return out
}

function clamp(value: string, limit: number): string {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

function base64Url(value: string): string {
  return Buffer.from(value).toString('base64url')
}
