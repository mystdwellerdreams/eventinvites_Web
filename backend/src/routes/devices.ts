import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, AuthRequest } from '../middleware/auth'
import { prisma } from '../utils/prisma'
import { sendPushMessages, isPushConfigured } from '../utils/push'

const router = Router()

const deviceSchema = z.object({
  token: z.string().min(10).max(4096),
  platform: z.enum(['android', 'ios', 'web']).default('android'),
  appVersion: z.string().max(40).optional(),
})

/**
 * Registers the device the signed-in user is using, so push notifications for
 * this account reach it.
 *
 * The token is unique across the system: a phone handed to another account
 * re-points its token rather than leaving a row that would deliver the old
 * owner's notifications. Upserting makes a repeated registration cheap, which
 * matters because the app registers on every launch.
 */
router.post(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = deviceSchema.parse(req.body)

    const device = await prisma.deviceToken.upsert({
      where: { token: data.token },
      update: {
        userId: req.user!.id,
        platform: data.platform,
        appVersion: data.appVersion ?? null,
        lastSeenAt: new Date(),
      },
      create: {
        token: data.token,
        userId: req.user!.id,
        platform: data.platform,
        appVersion: data.appVersion ?? null,
      },
      select: { id: true, platform: true },
    })

    res.status(201).json({ device })
  })
)

/**
 * Sends one notification to the caller's own devices.
 *
 * This is the diagnostic a tester runs after installing the app: a zero count
 * means no device token has been registered for this account yet, which is the
 * usual reason a real push never arrives. The message goes through the same
 * path as every other push, so a delivery here proves the whole chain —
 * service account, token, channel and app registration.
 */
router.post(
  '/test',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const devices = await prisma.deviceToken.count({
      where: { userId: req.user!.id },
    })

    if (devices > 0) {
      await sendPushMessages([
        {
          userId: req.user!.id,
          title: 'Event Invites',
          body: 'Test notification. If you can read this, push works.',
          data: { kind: 'test' },
        },
      ])
    }

    res.json({ devices, configured: isPushConfigured() })
  })
)

/**
 * Stops push notifications for this device. Called as the last step before a
 * sign-out, while the session still answers, so the next user of the phone
 * does not inherit the previous one's notifications.
 */
router.delete(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token : ''
    if (!token) {
      throw new AppError(400, 'Device token required')
    }

    await prisma.deviceToken.deleteMany({
      where: { token, userId: req.user!.id },
    })

    res.json({ message: 'Device removed' })
  })
)

export { router }
