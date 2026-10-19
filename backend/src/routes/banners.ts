import { Router } from 'express'
import { prisma } from '../utils/prisma'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import {
  authMiddleware,
  AuthRequest,
  requireAdmin,
  optionalAuth,
} from '../middleware/auth'
import { parseJsonField } from '../utils/serialize'
import { logActivity, actorName } from '../utils/activityLog'
import { createBroadcast, removeBroadcastsFor } from '../utils/notifications'
import {
  BANNER_SLOT_NAMES,
  bannerConfigSchemas,
  bannerTemplateSchema,
  bannerVoteSchema,
  copyCounterSchema,
  createBannerAdSchema,
  reorderBannerAdsSchema,
  updateBannerAdSchema,
  updateBannerSlotSchema,
} from '../utils/validation'
import type { BannerAdType } from '../utils/validation'

/**
 * Writes one banner entry to the activity log, unless the slot opted out
 * of logging. The ad's type is carried in the target, so the log line reads
 * "MAIN  · Cover" rather than a bare slot name.
 */
async function logBannerChange(
  slotId: string,
  adType: string,
  action: 'created' | 'changed' | 'removed',
  actorId: string
) {
  const slot = await prisma.bannerSlot.findUnique({
    where: { id: slotId },
    select: { slot: true, logChanges: true },
  })
  if (!slot || !slot.logChanges) return
  await logActivity({
    category: 'BANNER',
    actorId,
    actorName: await actorName(actorId),
    targetType: 'BANNER',
    targetId: slotId,
    targetName: `${slot.slot}  · ${adType}`,
    detail: action,
  })
}

/**
 * Home-page banners. The public surface is read-only apart from poll
 * votes; every mutation lives behind the admin router.
 */
const publicRouter = Router()
const adminRouter = Router()

const adSelect = {
  id: true,
  slotId: true,
  order: true,
  type: true,
  config: true,
  duration: true,
  isActive: true,
} as const

type BannerAdRow = {
  id: string
  slotId: string
  order: number
  type: string
  config: string
  duration: number
  isActive: boolean
}

/** The stored config is a JSON string; clients receive the object. */
function serializeAd<T extends BannerAdRow>(ad: T) {
  return { ...ad, config: parseJsonField(ad.config, {}) }
}

function serializeAds<T extends BannerAdRow>(ads: T[]) {
  return ads.map(serializeAd)
}

/** Creates the three slot rows on first use so the editor has them. */
async function ensureSlots() {
  for (const slot of BANNER_SLOT_NAMES) {
    await prisma.bannerSlot.upsert({
      where: { slot },
      update: {},
      create: { slot },
    })
  }
}

/* ------------------------------ public surface ----------------------------- */

/** Active slots with their active ads, in display order. */
publicRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const slots = await prisma.bannerSlot.findMany({
      where: { isActive: true },
      include: {
        ads: {
          where: { isActive: true },
          orderBy: { order: 'asc' },
          select: adSelect,
        },
      },
      orderBy: { slot: 'asc' },
    })
    res.json({
      slots: slots
        .filter((s) => s.ads.length > 0)
        .map((s) => ({ ...s, ads: serializeAds(s.ads) })),
    })
  })
)

/**
 * Casts a poll vote. Signed-in users vote once per poll, enforced by a
 * unique index; visitors vote without an account, with the browser
 * remembering the choice. Passing `previousOptionId` moves an existing
 * vote to a different option.
 */
publicRouter.post(
  '/:id/vote',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const { optionId, previousOptionId } = bannerVoteSchema.parse(req.body)

    const ad = await prisma.bannerAd.findUnique({
      where: { id: req.params.id },
      select: adSelect,
    })
    if (!ad || !ad.isActive) {
      throw new AppError(404, 'Banner not found')
    }
    if (ad.type !== 'POLL') {
      throw new AppError(400, 'This banner is not a poll')
    }

    const config = parseJsonField<{ options?: { id: string; votes?: number }[] }>(
      ad.config,
      {}
    )
    const options = config.options ?? []
    const option = options.find((o) => o.id === optionId)
    if (!option) {
      throw new AppError(400, 'Unknown poll option')
    }

    if (req.user) {
      const existing = await prisma.bannerPollVote.findUnique({
        where: { adId_userId: { adId: ad.id, userId: req.user.id } },
      })
      if (existing) {
        // A change must name the option being replaced.
        if (!previousOptionId || previousOptionId !== existing.optionId) {
          throw new AppError(409, 'You have already voted in this poll')
        }
        if (previousOptionId !== optionId) {
          await prisma.bannerPollVote.update({
            where: { id: existing.id },
            data: { optionId: option.id },
          })
          const replaced = options.find((o) => o.id === existing.optionId)
          if (replaced) {
            replaced.votes = Math.max(0, (replaced.votes ?? 0) - 1)
          }
          option.votes = (option.votes ?? 0) + 1
        }
      } else {
        await prisma.bannerPollVote.create({
          data: { adId: ad.id, optionId: option.id, userId: req.user.id },
        })
        option.votes = (option.votes ?? 0) + 1
      }
    } else {
      // Visitors have no server-side record; the client names the
      // option it is replacing, and the counts follow it.
      if (previousOptionId && previousOptionId !== optionId) {
        const replaced = options.find((o) => o.id === previousOptionId)
        if (replaced) {
          replaced.votes = Math.max(0, (replaced.votes ?? 0) - 1)
        }
      }
      option.votes = (option.votes ?? 0) + 1
    }

    const updated = await prisma.bannerAd.update({
      where: { id: ad.id },
      data: { config: JSON.stringify({ ...config, options }) },
      select: adSelect,
    })
    res.json({ ad: serializeAd(updated) })
  })
)

/**
 * Withdraws a poll vote. Signed-in users must have voted for the named
 * option; visitors' votes are remembered by the browser, so the client
 * names the option to release.
 */
publicRouter.post(
  '/:id/vote/cancel',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const { optionId } = bannerVoteSchema.parse(req.body)

    const ad = await prisma.bannerAd.findUnique({
      where: { id: req.params.id },
      select: adSelect,
    })
    if (!ad || !ad.isActive) {
      throw new AppError(404, 'Banner not found')
    }
    if (ad.type !== 'POLL') {
      throw new AppError(400, 'This banner is not a poll')
    }

    const config = parseJsonField<{ options?: { id: string; votes?: number }[] }>(
      ad.config,
      {}
    )
    const options = config.options ?? []
    const option = options.find((o) => o.id === optionId)
    if (!option) {
      throw new AppError(400, 'Unknown poll option')
    }

    if (req.user) {
      const existing = await prisma.bannerPollVote.findUnique({
        where: { adId_userId: { adId: ad.id, userId: req.user.id } },
        select: { id: true, optionId: true },
      })
      if (!existing || existing.optionId !== optionId) {
        throw new AppError(409, 'You have not voted for this option')
      }
      await prisma.bannerPollVote.delete({ where: { id: existing.id } })
    }

    option.votes = Math.max(0, (option.votes ?? 0) - 1)
    const updated = await prisma.bannerAd.update({
      where: { id: ad.id },
      data: { config: JSON.stringify({ ...config, options }) },
      select: adSelect,
    })
    res.json({ ad: serializeAd(updated) })
  })
)

/**
 * Records a copy out of a counter banner's details. Any visitor can trigger
 * it, but only a signed-in user is attributed: a copy with nobody behind it
 * adds nothing to the administrator's list.
 */
publicRouter.post(
  '/:id/copy',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = copyCounterSchema.parse(req.body)

    const ad = await prisma.bannerAd.findUnique({
      where: { id: req.params.id },
      select: { id: true, type: true, isActive: true },
    })
    if (!ad || ad.type !== 'COUNTER' || !ad.isActive) {
      throw new AppError(404, 'Banner not found')
    }

    if (req.user) {
      await prisma.bannerCounterCopy.upsert({
        where: {
          adId_userId_reference: {
            adId: ad.id,
            userId: req.user.id,
            reference: data.reference,
          },
        },
        update: { count: { increment: 1 } },
        create: { adId: ad.id, userId: req.user.id, reference: data.reference },
      })
    }

    res.json({ recorded: Boolean(req.user) })
  })
)

/** One ad by id, with the signed-in user's poll vote when known. */
publicRouter.get(
  '/:id',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const ad = await prisma.bannerAd.findUnique({
      where: { id: req.params.id },
      select: adSelect,
    })
    if (!ad || !ad.isActive) {
      throw new AppError(404, 'Banner not found')
    }
    let myVote: string | null = null
    if (req.user && ad.type === 'POLL') {
      const vote = await prisma.bannerPollVote.findUnique({
        where: { adId_userId: { adId: ad.id, userId: req.user.id } },
        select: { optionId: true },
      })
      myVote = vote?.optionId ?? null
    }
    res.json({ ad: serializeAd(ad), myVote })
  })
)

/* -------------------------------- admin ---------------------------------- */

/** Every slot with every ad, active or not, for the editor. */
adminRouter.get(
  '/',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    await ensureSlots()
    const slots = await prisma.bannerSlot.findMany({
      include: {
        ads: { orderBy: { order: 'asc' }, select: adSelect },
      },
      orderBy: { slot: 'asc' },
    })
    res.json({
      slots: slots.map((s) => ({ ...s, ads: serializeAds(s.ads) })),
    })
  })
)

/** Slot-level settings: the main banner's interval and the on/off flag. */
adminRouter.patch(
  '/slots/:slot',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const slotName = String(req.params.slot).toUpperCase()
    if (!BANNER_SLOT_NAMES.includes(slotName as (typeof BANNER_SLOT_NAMES)[number])) {
      throw new AppError(400, 'Unknown banner slot')
    }
    const data = updateBannerSlotSchema.parse(req.body)

    const slot = await prisma.bannerSlot.upsert({
      where: { slot: slotName },
      update: {
        ...(data.interval !== undefined ? { interval: data.interval } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.logChanges !== undefined ? { logChanges: data.logChanges } : {}),
      },
      create: { slot: slotName },
    })
    res.json({ slot })
  })
)

adminRouter.post(
  '/',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = createBannerAdSchema.parse(req.body)

    const slot = await prisma.bannerSlot.findUnique({
      where: { id: data.slotId },
      select: { id: true, slot: true },
    })
    if (!slot) {
      throw new AppError(400, 'Unknown banner slot')
    }

    // Side banners hold a single ad; the main banner rotates through many.
    if (slot.slot !== 'MAIN') {
      const existing = await prisma.bannerAd.findFirst({
        where: { slotId: slot.id },
        select: { id: true },
      })
      if (existing) {
        throw new AppError(
          400,
          'Side banners hold a single ad вЂ” edit or remove the existing one first'
        )
      }
    }

    const count = await prisma.bannerAd.count({ where: { slotId: slot.id } })
    const ad = await prisma.bannerAd.create({
      data: {
        slotId: slot.id,
        type: data.type,
        config: JSON.stringify(data.config),
        duration: data.duration ?? 5,
        isActive: data.isActive ?? true,
        order: count,
      },
      select: adSelect,
    })
    await logBannerChange(slot.id, ad.type, 'created', req.user!.id)
    // An active ad is an announcement: everybody sees it on the home page.
    if (ad.isActive) {
      await createBroadcast({
        type: 'ANNOUNCEMENT',
        sourceType: 'BANNER_AD',
        sourceId: ad.id,
        title: slot.slot,
        // The ad's kind travels as data, so the panel can word it in the
        // reader's language.
        meta: { adType: ad.type },
      })
    }
    res.status(201).json({ ad: serializeAd(ad) })
  })
)

adminRouter.patch(
  '/:id',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = updateBannerAdSchema.parse(req.body)

    const current = await prisma.bannerAd.findUnique({
      where: { id: req.params.id },
      select: { id: true, slotId: true, type: true },
    })
    if (!current) {
      throw new AppError(404, 'Banner not found')
    }
    // A config that arrives must still match the ad's (new) type.
    const type = (data.type ?? current.type) as BannerAdType
    if (data.config !== undefined) {
      const result = bannerConfigSchemas[type].safeParse(data.config)
      if (!result.success) {
        throw new AppError(
          400,
          `Invalid configuration: ${result.error.issues
            .map((issue) => issue.message)
            .join(', ')}`
        )
      }
    }

    // Moving an ad into a side slot follows the single-ad rule.
    if (data.slotId !== undefined && data.slotId !== current.slotId) {
      const target = await prisma.bannerSlot.findUnique({
        where: { id: data.slotId },
        select: { id: true, slot: true },
      })
      if (!target) {
        throw new AppError(400, 'Unknown banner slot')
      }
      if (target.slot !== 'MAIN') {
        const existing = await prisma.bannerAd.findFirst({
          where: { slotId: target.id, NOT: { id: current.id } },
          select: { id: true },
        })
        if (existing) {
          throw new AppError(
            400,
            'Side banners hold a single ad вЂ” edit or remove the existing one first'
          )
        }
      }
    }

    const ad = await prisma.bannerAd.update({
      where: { id: current.id },
      data: {
        ...(data.slotId !== undefined ? { slotId: data.slotId } : {}),
        ...(data.type !== undefined ? { type: data.type } : {}),
        ...(data.config !== undefined
          ? { config: JSON.stringify(data.config) }
          : {}),
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      select: adSelect,
    })
    await logBannerChange(ad.slotId, ad.type, 'changed', req.user!.id)
    res.json({ ad: serializeAd(ad) })
  })
)

adminRouter.delete(
  '/:id',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const ad = await prisma.bannerAd.findUnique({
      where: { id: req.params.id },
      select: { id: true, slotId: true, type: true },
    })
    if (!ad) {
      throw new AppError(404, 'Banner not found')
    }
    await prisma.bannerAd.delete({ where: { id: ad.id } })
    // The rows that hang off an ad carry no foreign keys, so they go with it
    // instead of being left behind for a banner that no longer exists.
    await prisma.bannerPollVote.deleteMany({ where: { adId: ad.id } })
    await prisma.bannerCounterCopy.deleteMany({ where: { adId: ad.id } })
    // Its announcement leaves the notification area with it.
    await removeBroadcastsFor('BANNER_AD', ad.id)
    await logBannerChange(ad.slotId, ad.type, 'removed', req.user!.id)
    res.json({ message: 'Banner removed' })
  })
)

/** Reorders the ads of a slot; the main banner rotates in this order. */
adminRouter.post(
  '/reorder',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const { slotId, ids } = reorderBannerAdsSchema.parse(req.body)

    const ads = await prisma.bannerAd.findMany({
      where: { slotId },
      select: { id: true },
    })
    if (ads.length !== ids.length || !ids.every((id) => ads.some((a) => a.id === id))) {
      throw new AppError(400, 'The ad list does not match this slot')
    }

    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.bannerAd.update({ where: { id }, data: { order: index } })
      )
    )

    const updated = await prisma.bannerAd.findMany({
      where: { slotId },
      orderBy: { order: 'asc' },
      select: adSelect,
    })
    res.json({ ads: serializeAds(updated) })
  })
)

/**
 * Who voted for what in a poll, for the editor's statistics:
 * every vote with the user behind it, grouped by option on the client.
 */
adminRouter.get(
  '/:id/votes',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const ad = await prisma.bannerAd.findUnique({
      where: { id: req.params.id },
      select: { id: true, type: true, config: true },
    })
    if (!ad) {
      throw new AppError(404, 'Banner not found')
    }
    if (ad.type !== 'POLL') {
      throw new AppError(400, 'This banner is not a poll')
    }

    const config = parseJsonField<
      { options?: { id: string; text?: string }[] }
    >(ad.config, {})
    const options = config.options ?? []

    const votes = await prisma.bannerPollVote.findMany({
      where: { adId: ad.id },
      orderBy: { createdAt: 'desc' },
    })
    const userIds = [...new Set(votes.map((vote) => vote.userId))]
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true, phone: true },
    })
    const userById = new Map(users.map((user) => [user.id, user]))

    res.json({
      voters: votes.map((vote) => {
        const user = userById.get(vote.userId)
        const option = options.find((o) => o.id === vote.optionId)
        return {
          userId: vote.userId,
          name: user?.name ?? vote.userId,
          email: user?.email ?? null,
          phone: user?.phone ?? null,
          optionId: vote.optionId,
          optionText: option?.text ?? '',
          createdAt: vote.createdAt.toISOString(),
        }
      }),
    })
  })
)

/**
 * A counter banner's control data: its current state plus everyone who
 * copied a reference out of its details text.
 */
adminRouter.get(
  '/:id/counter',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const ad = await prisma.bannerAd.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        type: true,
        isActive: true,
        config: true,
        slot: { select: { slot: true } },
      },
    })
    if (!ad) {
      throw new AppError(404, 'Banner not found')
    }
    if (ad.type !== 'COUNTER') {
      throw new AppError(400, 'This banner is not a counter')
    }

    const config = parseJsonField<{
      current?: number
      target?: number
      label?: string
      currency?: string
      details?: string
    }>(ad.config, {})

    const copies = await prisma.bannerCounterCopy.findMany({
      where: { adId: ad.id },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    })
    const userIds = [...new Set(copies.map((copy) => copy.userId))]
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, avatar: true, email: true, phone: true },
    })
    const userById = new Map(users.map((user) => [user.id, user]))

    res.json({
      ad: {
        id: ad.id,
        slot: ad.slot?.slot ?? '',
        isActive: ad.isActive,
        label: config.label ?? '',
        current: config.current ?? 0,
        target: config.target ?? 0,
        currency: config.currency ?? '',
        details: config.details ?? '',
      },
      copies: copies.map((copy) => {
        const user = userById.get(copy.userId)
        return {
          userId: copy.userId,
          name: user?.name ?? copy.userId,
          avatar: user?.avatar ?? null,
          email: user?.email ?? null,
          phone: user?.phone ?? null,
          reference: copy.reference,
          count: copy.count,
          createdAt: copy.createdAt.toISOString(),
          updatedAt: copy.updatedAt.toISOString(),
        }
      }),
    })
  })
)

/* ------------------------------ template library ---------------------------- */
/** Saved ad configurations, newest first. */
adminRouter.get(
  '/templates',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const templates = await prisma.bannerTemplate.findMany({
      orderBy: { createdAt: 'desc' },
    })
    res.json({
      templates: templates.map((template) => ({
        ...template,
        config: parseJsonField(template.config, {}),
      })),
    })
  })
)

/** Saves the current form settings as a named template. */
adminRouter.post(
  '/templates',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = bannerTemplateSchema.parse(req.body)
    const template = await prisma.bannerTemplate.create({
      data: {
        name: data.name,
        type: data.type,
        config: JSON.stringify(data.config),
      },
    })
    res.status(201).json({
      template: {
        ...template,
        config: parseJsonField(template.config, {}),
      },
    })
  })
)

adminRouter.delete(
  '/templates/:id',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const template = await prisma.bannerTemplate.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    })
    if (!template) {
      throw new AppError(404, 'Template not found')
    }
    await prisma.bannerTemplate.delete({ where: { id: template.id } })
    res.json({ message: 'Template removed' })
  })
)

export { publicRouter, adminRouter }
