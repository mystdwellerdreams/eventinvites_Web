import { Router } from 'express'
import { asyncHandler, AppError } from '../middleware/errorHandler'
import { authMiddleware, AuthRequest, requireAdmin } from '../middleware/auth'
import { atLeast, isGuest } from '../utils/roles'
import { prisma } from '../utils/prisma'
import {
  createChatMessageSchema,
  createCommentSchema,
  openChatSchema,
  setChatReadonlySchema,
} from '../utils/validation'
import {
  CHAT_KINDS,
  canOpenChat,
  canWriteInChat,
  ensureChat,
  listChats,
  loadThread,
  markChatRead,
  messagesLink,
  type ChatMessageView,
  postChatMessage,
} from '../utils/chats'
import { createEventComment } from './comments'

const router = Router()

type ChatKind = (typeof CHAT_KINDS)[number]

/** Loads the chat and answers whether this viewer may open it. */
async function loadChatFor(chatId: string, viewer: { id: string; role: string }) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      kind: true,
      userId: true,
      adminId: true,
      eventId: true,
      userReadOnly: true,
    },
  })
  if (!chat) {
    throw new AppError(404, 'Conversation not found')
  }
  if (!canOpenChat(chat, viewer)) {
    throw new AppError(403, 'This conversation is not yours')
  }
  return chat
}

/**
 * Every conversation this viewer takes part in. A guest has none: the
 * Messages section stays closed until an administrator approves the
 * account.
 */
router.get(
  '/',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const viewer = { id: req.user!.id, role: req.user!.role }
    res.json({ chats: await listChats(viewer) })
  })
)

/**
 * One conversation with its messages. Opening it is also the act of
 * reading it, so the unread count is reset here.
 */
router.get(
  '/:id',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const viewer = { id: req.user!.id, role: req.user!.role }
    const chat = await loadChatFor(req.params.id, viewer)
    await markChatRead(chat.id, viewer.id)
    const thread = await loadThread(chat.id, viewer)
    res.json({
      chat: thread.chat,
      messages: thread.messages,
      viewerIsAdmin: thread.viewerIsAdmin,
      /** Where a notification row leads to open this conversation. */
      link: messagesLink(chat.id),
    })
  })
)

/**
 * Writes one message. A SUPPORT or ADMIN chat takes plain text; an EVENT
 * chat takes a comment, which lands on the event's page as well, so it is
 * checked against the comment rules — one writer per resource, one limit.
 */
router.post(
  '/:id/messages',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const viewer = { id: req.user!.id, role: req.user!.role }
    if (isGuest(viewer.role)) {
      throw new AppError(403, 'Guest accounts cannot write messages yet.')
    }
    const chat = await loadChatFor(req.params.id, viewer)
    if (!canWriteInChat(chat, viewer)) {
      throw new AppError(403, 'An administrator stopped you from writing here.')
    }

    if (chat.kind === 'EVENT') {
      if (!chat.eventId) {
        throw new AppError(404, 'Conversation not found')
      }
      // A message in a thread is a comment on the event, so the comment
      // schema decides what may be written.
      const commentData = createCommentSchema.parse(req.body)
      const { comment } = await createEventComment(chat.eventId, viewer, commentData)
      // The answer is the comment itself: reading the thread back would
      // fetch hundreds of rows to return one, and the newest row of a long
      // thread is not necessarily the one just written.
      const message: ChatMessageView = {
        id: comment.id,
        authorId: comment.author.id,
        displayName: comment.author.name,
        displayAvatar: comment.author.avatar,
        html: false,
        body: comment.body,
        own: comment.author.id === viewer.id,
        createdAt: comment.createdAt.toISOString(),
      }
      res.status(201).json({ message, comment })
      return
    }

    const data = createChatMessageSchema.parse(req.body)
    const message = await postChatMessage(chat.id, viewer.id, data.body)
    res.status(201).json({ message })
  })
)

/** Marks one conversation read without loading it again. */
router.post(
  '/:id/read',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const viewer = { id: req.user!.id, role: req.user!.role }
    await loadChatFor(req.params.id, viewer)
    await markChatRead(req.params.id, viewer.id)
    res.json({ message: 'Marked as read' })
  })
)

/**
 * Opens a conversation as an administrator: the feedback chat of any
 * user, a personal conversation with them, or the thread of an event
 * they commented on.
 */
router.post(
  '/open',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const data = openChatSchema.parse(req.body)
    const chat = await ensureChat(data.kind as ChatKind, data.userId, {
      eventId: data.eventId ?? null,
      adminId: data.kind === 'ADMIN' ? req.user!.id : null,
    })
    res.status(201).json({ chat })
  })
)

/** Lets an administrator stop a user from writing in a conversation. */
router.post(
  '/:id/readonly',
  authMiddleware,
  requireAdmin,
  asyncHandler(async (req: AuthRequest, res) => {
    const chat = await prisma.chat.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    })
    if (!chat) {
      throw new AppError(404, 'Conversation not found')
    }
    const data = setChatReadonlySchema.parse(req.body)
    const updated = await prisma.chat.update({
      where: { id: chat.id },
      data: { userReadOnly: data.readOnly },
      select: { id: true, userReadOnly: true },
    })
    res.json({ chat: updated })
  })
)

/** Whether the viewer's role may message at all. */
router.get(
  '/status',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res) => {
    const role = req.user!.role
    res.json({
      enabled: !isGuest(role),
      admin: atLeast(role, 'ADMIN'),
    })
  })
)

export { router }
