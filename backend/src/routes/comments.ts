import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../utils/prisma'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import {
  authMiddleware,
  optionalAuth,
  AuthRequest,
  requireAdmin,
} from '../middleware/auth'
import { loadEventForComments } from '../utils/eventAccess'
import { atLeast, isGuest } from '../utils/roles'
import { blockCommenterSchema, createCommentSchema } from '../utils/validation'
import { areCommentsLogged, logActivity } from '../utils/activityLog'
import { notifyUser } from '../utils/notifications'
import {
  ensureChat,
  notifyEventThreads,
  plainPreview,
} from '../utils/chats'

const router = Router()

const commentAuthorSelect = {
  id: true,
  name: true,
  avatar: true,
  role: true,
} as const

const commentSelect = {
  id: true,
  eventId: true,
  authorId: true,
  parentId: true,
  quoteCommentId: true,
  quoteText: true,
  body: true,
  pinned: true,
  pinnedAt: true,
  banned: true,
  bannedAt: true,
  deletedAt: true,
  createdAt: true,
  updatedAt: true,
  author: { select: commentAuthorSelect },
  quoteComment: {
    select: {
      id: true,
      body: true,
      author: { select: { id: true, name: true } },
    },
  },
} as const

interface Viewer {
  id: string
  role: string
}

/** Flattens the quote reference for the client, which renders a snippet. */
function serializeComment(comment: Record<string, unknown> & {
  quoteComment?: { id: string; body: string; author: { id: string; name: string } } | null
}) {
  const { quoteComment, ...rest } = comment
  return {
    ...rest,
    quote: quoteComment
      ? {
          id: quoteComment.id,
          authorName: quoteComment.author.name,
          authorId: quoteComment.author.id,
          snippet: quoteComment.body,
        }
      : null,
  }
}

/** Reads the discussion. Anyone who can open the event page may read it. */
router.get(
  '/events/:eventId',
  optionalAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const viewer = req.user
    const event = await loadEventForComments(req.params.eventId, viewer)
    const viewerIsAdmin = atLeast(viewer?.role, 'ADMIN')

    const comments = await prisma.eventComment.findMany({
      where: {
        eventId: event.id,
        // A banned comment is hidden from everyone but administrators, so a
        // moderation decision can still be undone.
        ...(viewerIsAdmin ? {} : { banned: false }),
      },
      select: commentSelect,
      // Pinned first, everything else in the order it was written.
      orderBy: [{ pinned: 'desc' }, { createdAt: 'asc' }],
    })

    const viewerBlocked = viewer
      ? Boolean(
          await prisma.eventCommentBlock.findUnique({
            where: { eventId_userId: { eventId: event.id, userId: viewer.id } },
          })
        )
      : false

    // Who is blocked is administrator-only knowledge.
    const blocks = viewerIsAdmin
      ? await prisma.eventCommentBlock.findMany({
          where: { eventId: event.id },
          select: {
            id: true,
            reason: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: 'desc' },
        })
      : []

    res.json({
      comments: comments.map(serializeComment),
      blocks,
      viewerBlocked,
      viewerIsAdmin,
    })
  })
)

type CreateComment = z.infer<typeof createCommentSchema>

/**
 * Writes one comment and everything that follows from it: the log entry,
 * the reply notification, and the event's thread in the Messages
 * section — the author's chat, opened if they do not have one yet, with
 * every other participant's thread moved to the top of their chat list.
 */
async function createEventComment(
  eventId: string,
  viewer: Viewer,
  data: CreateComment
) {
  const event = await loadEventForComments(eventId, viewer)

  // Guests browse events but do not take part in the discussion until an
  // administrator approves the account.
  if (isGuest(viewer.role)) {
    throw new AppError(
      403,
      'Guest accounts cannot comment yet. An administrator approves your account first.'
    )
  }

  const blocked = await prisma.eventCommentBlock.findUnique({
    where: { eventId_userId: { eventId: event.id, userId: viewer.id } },
  })
  if (blocked) {
    throw new AppError(
      403,
      'An administrator blocked you from commenting on this event.'
    )
  }

  // The parent is looked up once: the reply is checked against it, and it
  // says who to notify about the reply afterwards.
  let parentAuthorId: string | null = null
  if (data.parentId) {
    const parent = await prisma.eventComment.findUnique({
      where: { id: data.parentId },
      select: { id: true, eventId: true, authorId: true },
    })
    if (!parent || parent.eventId !== event.id) {
      throw new AppError(400, 'The comment you are replying to is no longer here.')
    }
    parentAuthorId = parent.authorId
  }

  if (data.quoteCommentId) {
    const quoted = await prisma.eventComment.findUnique({
      where: { id: data.quoteCommentId },
      select: { id: true, eventId: true },
    })
    if (!quoted || quoted.eventId !== event.id) {
      throw new AppError(400, 'The comment you are quoting is no longer here.')
    }
  }

  const comment = await prisma.eventComment.create({
    data: {
      eventId: event.id,
      authorId: viewer.id,
      parentId: data.parentId ?? null,
      quoteCommentId: data.quoteCommentId ?? null,
      quoteText: data.quoteText ?? null,
      body: data.body,
    },
    select: commentSelect,
  })

  // Comment logging is an administrator's choice, off until switched on.
  if (await areCommentsLogged()) {
    await logActivity({
      category: data.parentId ? 'COMMENT_REPLY' : 'COMMENT',
      actorId: viewer.id,
      actorName: comment.author.name,
      targetType: 'COMMENT',
      targetId: comment.id,
      targetName: event.title,
      detail: comment.body.slice(0, 200),
      // The log line opens the comment where it lives, so the event it
      // belongs to travels with the entry.
      meta: { eventId: event.id },
    })
  }

  // A reply tells the author of the comment being answered.
  if (parentAuthorId && parentAuthorId !== viewer.id) {
    await notifyUser({
      userId: parentAuthorId,
      type: 'COMMENT_REPLY',
      title: event.title,
      targetType: 'COMMENT',
      targetId: comment.id,
      // The click opens the reply where it stands, so the event it
      // belongs to travels with the notification.
      meta: { eventId: event.id },
    })
  }

  // The Messages section mirrors the discussion: the comment author gets
  // the event's thread if they do not have it yet, every thread of this
  // event moves to the top of its owner's list, and those owners hear
  // about the new message — except the one already told by the reply.
  await ensureChat('EVENT', viewer.id, { eventId: event.id })
  await prisma.chat.updateMany({
    where: { kind: 'EVENT', eventId: event.id },
    data: { lastMessageAt: comment.createdAt },
  })
  await notifyEventThreads(
    event.id,
    event.title,
    viewer.id,
    parentAuthorId,
    plainPreview(comment.body)
  )

  return { comment, event }
}

/** Writes a comment, a reply, or a comment quoting another comment or an
 *  element of the page. */
router.post(
  '/events/:eventId',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const viewer: Viewer = { id: req.user!.id, role: req.user!.role }
    const data = createCommentSchema.parse(req.body)
    const { comment } = await createEventComment(req.params.eventId, viewer, data)
    res.status(201).json({ comment: serializeComment(comment) })
  })
)

/** Pins or unpins a comment. Only one comment per event is ever pinned. */
router.post(
  '/:id/pin',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const existing = await prisma.eventComment.findUnique({
      where: { id: req.params.id },
      select: { id: true, eventId: true, pinned: true },
    })
    if (!existing) {
      throw new AppError(404, 'Comment not found')
    }

    if (existing.pinned) {
      const updated = await prisma.eventComment.update({
        where: { id: existing.id },
        data: { pinned: false, pinnedAt: null, pinnedById: null },
        select: commentSelect,
      })
      res.json({ comment: serializeComment(updated) })
      return
    }

    await prisma.eventComment.updateMany({
      where: { eventId: existing.eventId, pinned: true, id: { not: existing.id } },
      data: { pinned: false, pinnedAt: null, pinnedById: null },
    })

    const updated = await prisma.eventComment.update({
      where: { id: existing.id },
      data: { pinned: true, pinnedAt: new Date(), pinnedById: req.user!.id },
      select: commentSelect,
    })
    res.json({ comment: serializeComment(updated) })
  })
)

/** Bans or unbans a comment. A ban hides it from everyone but administrators. */
router.post(
  '/:id/ban',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const existing = await prisma.eventComment.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        banned: true,
        authorId: true,
        eventId: true,
        event: { select: { title: true } },
      },
    })
    if (!existing) {
      throw new AppError(404, 'Comment not found')
    }

    const data = existing.banned
      ? { banned: false, bannedAt: null, bannedById: null }
      : { banned: true, bannedAt: new Date(), bannedById: req.user!.id }

    const updated = await prisma.eventComment.update({
      where: { id: existing.id },
      data,
      select: commentSelect,
    })

    // The author hears when their comment is banned. Unbanning is the act of
    // putting it back, so it goes unmentioned.
    if (!existing.banned && existing.authorId !== req.user!.id) {
      await notifyUser({
        userId: existing.authorId,
        type: 'COMMENT_BAN',
        title: existing.event.title,
        targetType: 'EVENT',
        targetId: existing.eventId,
      })
    }
    res.json({ comment: serializeComment(updated) })
  })
)

/** Soft delete. The author removes their own comment; an administrator can
 *  remove anyone's. The row stays so a thread never loses its shape. */
router.delete(
  '/:id',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const existing = await prisma.eventComment.findUnique({
      where: { id: req.params.id },
      select: { id: true, authorId: true, pinned: true },
    })
    if (!existing) {
      throw new AppError(404, 'Comment not found')
    }

    const isAdmin = atLeast(req.user!.role, 'ADMIN')
    if (existing.authorId !== req.user!.id && !isAdmin) {
      throw new AppError(403, 'You can only delete your own comments')
    }

    const updated = await prisma.eventComment.update({
      where: { id: existing.id },
      data: {
        deletedAt: new Date(),
        // A removed comment is never the pinned one.
        pinned: false,
        pinnedAt: null,
        pinnedById: null,
      },
      select: commentSelect,
    })
    res.json({ comment: serializeComment(updated) })
  })
)

/* ------------------------------ comment blocks ----------------------------- */

/**
 * Writes one comment and everything that follows from it, shared by the
 * event page's composer and the Messages section's composer: a comment
 * written in a chat is a comment on the event all the same.
 */
export { createEventComment }

/** Who an administrator stopped from commenting on this event. */
router.get(
  '/events/:eventId/blocks',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    await loadEventForComments(req.params.eventId, {
      id: req.user!.id,
      role: req.user!.role,
    })
    const blocks = await prisma.eventCommentBlock.findMany({
      where: { eventId: req.params.eventId },
      select: {
        id: true,
        reason: true,
        createdAt: true,
        user: { select: { id: true, name: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ blocks })
  })
)

/** Blocks a user from commenting on this event. */
router.post(
  '/events/:eventId/blocks',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const viewer: Viewer = { id: req.user!.id, role: req.user!.role }
    const event = await loadEventForComments(req.params.eventId, viewer)
    const data = blockCommenterSchema.parse(req.body)

    if (data.userId === viewer.id) {
      throw new AppError(400, 'You cannot block yourself')
    }

    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true, name: true },
    })
    if (!user) {
      throw new AppError(404, 'User not found')
    }

    const existing = await prisma.eventCommentBlock.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: data.userId } },
    })
    if (existing) {
      throw new AppError(409, 'That user is already blocked on this event')
    }

    const block = await prisma.eventCommentBlock.create({
      data: {
        eventId: event.id,
        userId: data.userId,
        createdById: viewer.id,
        reason: data.reason || null,
      },
      select: {
        id: true,
        reason: true,
        createdAt: true,
        user: { select: { id: true, name: true, avatar: true } },
      },
    })

    // Being kept out of a discussion is worth saying plainly.
    if (data.userId !== viewer.id) {
      await notifyUser({
        userId: data.userId,
        type: 'COMMENT_BLOCK',
        title: event.title,
        targetType: 'EVENT',
        targetId: event.id,
        meta: block.reason ? { reason: block.reason } : null,
      })
    }

    res.status(201).json({ block })
  })
)

/** Lifts a block again. */
router.delete(
  '/events/:eventId/blocks/:userId',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const viewer: Viewer = { id: req.user!.id, role: req.user!.role }
    await loadEventForComments(req.params.eventId, viewer)

    const block = await prisma.eventCommentBlock.findUnique({
      where: {
        eventId_userId: { eventId: req.params.eventId, userId: req.params.userId },
      },
    })
    if (!block) {
      throw new AppError(404, 'That user is not blocked on this event')
    }

    await prisma.eventCommentBlock.delete({ where: { id: block.id } })
    res.json({ message: 'Block lifted' })
  })
)

export { router }
