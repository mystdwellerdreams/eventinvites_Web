import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../utils/prisma'
import { generateTokens, verifyRefreshToken, AuthRequest, AuthUser, authMiddleware } from '../middleware/auth'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  setPasswordSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
} from '../utils/validation'
import { phoneKey } from '../utils/phone'
import { requireCaptcha } from '../utils/captcha'
import {
  createPasswordReset,
  validatePasswordReset,
  consumePasswordReset,
} from '../utils/passwordResets'
import { ROLES, GUEST_ROLE } from '../utils/roles'
import { checkInvite, consumeInvite } from '../utils/invites'
import { withParsedUserJson, serializeJsonField } from '../utils/serialize'
import { SOCIAL_PLATFORM_SPECS } from '../utils/socialPlatforms'
import { clearCookie, cookieOptions } from '../utils/cookies'
import { logActivity } from '../utils/activityLog'
import { notifyUser } from '../utils/notifications'

const router = Router()

const publicUserSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  avatar: true,
  phone: true,
  socialLinks: true,
} as const

const publicUserSelectWithPhoneKey = { ...publicUserSelect, phoneKey: true } as const

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

function setAuthCookies(res: import('express').Response, accessToken: string, refreshToken: string) {
  res.cookie('accessToken', accessToken, cookieOptions(15 * 60 * 1000))
  res.cookie('refreshToken', refreshToken, cookieOptions(REFRESH_TOKEN_TTL_MS))
}

async function issueSession(user: AuthUser, res: import('express').Response) {
  const { accessToken, refreshToken } = generateTokens(user)
  await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  })
  setAuthCookies(res, accessToken, refreshToken)
  return { accessToken, refreshToken }
}

async function assertIdentifierFree(
  identifier: { email?: string | null; phone: string },
  excludeUserId?: string
) {
  const owner = await prisma.user.findFirst({
    where: {
      phoneKey: phoneKey(identifier.phone),
      ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
    },
    select: { id: true },
  })
  if (owner) {
    throw new AppError(409, 'That phone number is already registered')
  }

  if (identifier.email) {
    const emailOwner = await prisma.user.findFirst({
      where: { email: identifier.email, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
      select: { id: true },
    })
    if (emailOwner) {
      throw new AppError(409, 'That email address is already registered')
    }
  }
}

router.post(
  '/register',
  requireCaptcha('register'),
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body)

    await assertIdentifierFree({ email: data.email, phone: data.phone })

    // A valid invitation grants a full account straight away; without one the
    // account is a guest until an administrator approves it.
    const invite = await checkInvite(data.invite || undefined)
    const role = invite.ok ? 'USER' : GUEST_ROLE

    const initialPassword = data.password || data.phone
    const passwordHash = await bcrypt.hash(initialPassword, 10)
    const user = await prisma.user.create({
      data: {
        name: data.name,
        phone: data.phone,
        phoneKey: phoneKey(data.phone),
        email: data.email || null,
        passwordHash,
        role,
      },
      select: publicUserSelect,
    })

    if (invite.ok) {
      await consumeInvite(invite.inviteId)
    }

    await logActivity({
      category: 'REGISTRATION',
      actorId: user.id,
      actorName: user.name,
      targetType: 'USER',
      targetId: user.id,
      targetName: user.name,
      // A guest account is not usable until it is approved.
      detail: role === GUEST_ROLE ? 'guest' : 'user',
    })

    // When no password was chosen the phone number signs the account in, so
    // the new user is told to pick one of their own.
    if (!data.password) {
      await notifyUser({
        userId: user.id,
        type: 'PASSWORD_ADVICE',
        targetType: 'USER',
        targetId: user.id,
      })
    }

    const { accessToken, refreshToken } = await issueSession(user, res)
    const isAppClient = req.body?.client === 'app'
    res.status(201).json({
      user: withParsedUserJson(user),
      accessToken,
      ...(isAppClient ? { refreshToken } : {}),
      role,
      message:
        role === GUEST_ROLE
          ? 'Account created as a guest. An administrator needs to approve it before you can register for events.'
          : data.password
            ? 'Account created'
            : 'Account created. Your phone number is your temporary password - set a password in your profile.',
    })
  })
)

/** Lets the sign-up form report whether an invitation link is valid. */
router.get(
  '/invite/:token',
  asyncHandler(async (req, res) => {
    const result = await checkInvite(req.params.token)
    res.json(result)
  })
)

router.post(
  '/login',
  requireCaptcha('login'),
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body)
    const identifier = data.identifier.trim()
    const digits = phoneKey(identifier)

    const candidates = await prisma.user.findMany({
      where: {
        OR: [
          ...(identifier.includes('@') ? [{ email: identifier.toLowerCase() }] : []),
          { name: { equals: identifier } },
          { name: { contains: identifier } },
          ...(digits ? [{ phoneKey: digits }] : []),
        ],
      },
      select: { ...publicUserSelectWithPhoneKey, passwordHash: true },
      take: 10,
    })

    const lowerIdentifier = identifier.toLowerCase()
    const isExact = (candidate: (typeof candidates)[number]) =>
      candidate.email === lowerIdentifier ||
      candidate.phoneKey === digits ||
      candidate.name === identifier

    const exactFirst = [...candidates].sort((a, b) => Number(isExact(b)) - Number(isExact(a)))

    let matched: (typeof candidates)[number] | null = null
    for (const candidate of exactFirst) {
      if (await bcrypt.compare(data.password, candidate.passwordHash)) {
        matched = candidate
        break
      }
    }

    if (!matched) {
      throw new AppError(401, 'Invalid credentials')
    }

    const { passwordHash: _passwordHash, phoneKey: _phoneKey, ...user } = matched
    const { accessToken, refreshToken } = await issueSession(user, res)
    const isAppClient = req.body?.client === 'app'
    res.json({
      user: withParsedUserJson(user),
      accessToken,
      ...(isAppClient ? { refreshToken } : {}),
    })
  })
)

router.get(
  '/roles',
  asyncHandler(async (_req, res) => {
    res.json({ roles: ROLES })
  })
)

/**
 * Password recovery. The visitor names the phone number of their
 * profile; when one matches, a reset request is created and shows up
 * in the administrator's Status tab, where a link is generated for
 * the user. The response never reveals whether the number exists.
 */
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const data = requestPasswordResetSchema.parse(req.body)

    const user = await prisma.user.findUnique({
      where: { phoneKey: phoneKey(data.phone) },
      select: { id: true, name: true },
    })
    if (user) {
      await createPasswordReset(user.id)
      // The pending request is already listed under Status; the log records
      // when it was made. The response above stays generic either way.
      await logActivity({
        category: 'PASSWORD_RESET',
        actorId: user.id,
        actorName: user.name,
        targetType: 'USER',
        targetId: user.id,
        targetName: user.name,
      })
    }

    res.json({
      message:
        'If that phone number is registered, a reset request has been sent to the administrators. They will provide a reset link.',
    })
  })
)

/** Checks a reset link before the new password form is shown. */
router.get(
  '/password-reset/:token',
  asyncHandler(async (req, res) => {
    const record = await validatePasswordReset(req.params.token)
    const user = await prisma.user.findUnique({
      where: { id: record.userId },
      select: { id: true, name: true, phone: true },
    })
    if (!user) {
      throw new AppError(404, 'User not found')
    }
    res.json({ ok: true, user })
  })
)

/** Sets a new password through a reset link. */
router.post(
  '/password-reset/:token',
  asyncHandler(async (req, res) => {
    const data = resetPasswordSchema.parse(req.body)
    const record = await validatePasswordReset(req.params.token)

    const user = await prisma.user.findUnique({ where: { id: record.userId } })
    if (!user) {
      throw new AppError(404, 'User not found')
    }

    const passwordHash = await bcrypt.hash(data.newPassword, 10)
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } })
    await consumePasswordReset(record.token)

    // The password changed out of band, so every session is ended
    // and the user signs in with the new password.
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } })

    res.json({ message: 'Password reset. Please sign in with your new password.' })
  })
)

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    // The app sends its refresh token in the body; the browser sends a cookie.
    const bodyToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined
    const cookieToken = req.cookies?.refreshToken
    const refreshToken = bodyToken ?? cookieToken
    const fromBody = !!bodyToken
    if (!refreshToken) {
      throw new AppError(401, 'Refresh token required')
    }

    let decoded: { id: string }
    try {
      decoded = verifyRefreshToken(refreshToken)
    } catch {
      clearCookie(res, 'accessToken')
      clearCookie(res, 'refreshToken')
      throw new AppError(401, 'Invalid refresh token')
    }

    const storedToken = await prisma.refreshToken.findUnique({ where: { token: refreshToken } })
    if (!storedToken || storedToken.expiresAt < new Date()) {
      clearCookie(res, 'accessToken')
      clearCookie(res, 'refreshToken')
      throw new AppError(401, 'Refresh token expired')
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.id } })
    if (!user) {
      throw new AppError(401, 'User not found')
    }

    await prisma.refreshToken.delete({ where: { token: refreshToken } })
    const { accessToken, refreshToken: newRefreshToken } = await issueSession(user, res)

    res.json({
      accessToken,
      ...(fromBody ? { refreshToken: newRefreshToken } : {}),
    })
  })
)

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    // The app sends its refresh token in the body; the browser sends a cookie.
    const refreshToken = req.body?.refreshToken ?? req.cookies?.refreshToken
    if (refreshToken) {
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } })
    }
    clearCookie(res, 'accessToken')
    clearCookie(res, 'refreshToken')
    res.json({ message: 'Logged out successfully' })
  })
)

router.get(
  '/me',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { ...publicUserSelect, createdAt: true },
    })
    if (!user) {
      throw new AppError(404, 'User not found')
    }
    res.json({ user: withParsedUserJson(user) })
  })
)

router.patch(
  '/profile',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = updateProfileSchema.parse(req.body)

    if (data.phone !== undefined) {
      await assertIdentifierFree({ phone: data.phone }, req.user!.id)
    }

    // Turn the handles the administrator typed into canonical URLs before
    // storing them, so the profile always holds ready-to-open links.
    const links =
      data.socialLinks !== undefined
        ? data.socialLinks.map((link) => ({
            platform: link.platform,
            url: SOCIAL_PLATFORM_SPECS[link.platform].build(link.value) ?? link.value,
            ...(link.label?.trim() ? { label: link.label.trim() } : {}),
          }))
        : undefined

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.phone !== undefined
          ? { phone: data.phone, phoneKey: phoneKey(data.phone) }
          : {}),
        ...(links !== undefined
          ? { socialLinks: serializeJsonField(links) ?? null }
          : {}),
      },
      select: publicUserSelect,
    })

    res.json({ user: withParsedUserJson(user) })
  })
)

router.patch(
  '/password',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = setPasswordSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } })
    if (!user) {
      throw new AppError(404, 'User not found')
    }

    const validPassword = await bcrypt.compare(data.currentPassword, user.passwordHash)
    if (!validPassword) {
      throw new AppError(401, 'Current password is incorrect')
    }

    const passwordHash = await bcrypt.hash(data.newPassword, 10)
    await prisma.user.update({ where: { id: req.user!.id }, data: { passwordHash } })

    await prisma.refreshToken.deleteMany({ where: { userId: req.user!.id } })
    clearCookie(res, 'accessToken')
    clearCookie(res, 'refreshToken')

    res.json({ message: 'Password changed. Please log in again.' })
  })
)

router.patch(
  '/avatar',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const { avatar } = (req.body ?? {}) as { avatar?: unknown }
    if (typeof avatar !== 'string') {
      throw new AppError(400, 'Avatar URL required')
    }

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { avatar: avatar || null },
      select: publicUserSelect,
    })

    res.json({ user: withParsedUserJson(user) })
  })
)

export { router }