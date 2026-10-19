import { Prisma } from '../generated/prisma/client'
import { prisma } from './prisma'
import { notifyUser, notifyUsers } from './notifications'
import { sanitizeHtml } from './sanitizeHtml'
import { logActivity } from './activityLog'
import { atLeast, isGuest } from './roles'
import { loadEventForComments } from './eventAccess'

/** SUPPORT = feedback, ADMIN = a personal conversation, EVENT = an
 *  event's comment thread. */
export const CHAT_KINDS = ['SUPPORT', 'ADMIN', 'EVENT'] as const
export type ChatKind = (typeof CHAT_KINDS)[number]

/**
 * The name every administrator's feedback answer is shown under. The real
 * author stays on record in the activity log and on the message itself;
 * the user only ever sees this name.
 */
export const SUPPORT_DISPLAY_NAME = 'Technical Support'

/** Where the Messages section opens a chat; notifications lead here. */
export const messagesLink = (chatId: string) => `/messages?chat=${chatId}`

export interface ChatViewer {
  id: string
  role: string
}

const authorSelect = {
  id: true,
  name: true,
  avatar: true,
  role: true,
} as const

const chatInclude = {
  id: true,
  kind: true,
  userId: true,
  adminId: true,
  eventId: true,
  userReadOnly: true,
  lastMessageAt: true,
  createdAt: true,
  user: { select: authorSelect },
  admin: { select: authorSelect },
  event: { select: { id: true, title: true, key: true } },
  messages: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { body: true, authorId: true, createdAt: true },
  },
} as const

type ChatRow = {
  id: string
  kind: string
  userId: string
  adminId: string | null
  eventId: string | null
  userReadOnly: boolean
  lastMessageAt: Date
  createdAt: Date
  user: { id: string; name: string; avatar: string | null; role: string }
  admin: { id: string; name: string; avatar: string | null; role: string } | null
  event: { id: string; title: string; key: string } | null
  messages: { body: string; authorId: string; createdAt: Date }[]
}

/** One chat as this viewer sees it. */
export interface ChatSummary {
  id: string
  kind: ChatKind
  /** The chat's name from this viewer's side. */
  title: string
  avatar: string | null
  subtitle: string | null
  /** The other side of the conversation, when it is one person. */
  counterpartId: string | null
  counterpartRole: string | null
  eventId: string | null
  /** The event's page, where an EVENT thread lives as comments. */
  eventKey: string | null
  /** The last message as plain text. */
  preview: string | null
  lastMessageAt: string
  unread: number
  /** Whether this viewer may write; an administrator always may. */
  canWrite: boolean
  /** Whether an administrator stopped the user from writing here. */
  userReadOnly: boolean
}

/** One message of a thread. */
export interface ChatMessageView {
  id: string
  authorId: string
  /** How the author is shown: their own name, or Technical Support. */
  displayName: string
  displayAvatar: string | null
  /** SUPPORT and ADMIN bodies are sanitized HTML; EVENT bodies are text. */
  html: boolean
  body: string
  own: boolean
  createdAt: string
}

/** A one-line preview of a message body, for the chat list. */
export function plainPreview(body: string, max = 160): string {
  const text = body
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max - 1)}вЂ¦` : text
}

/**
 * The chat of a kind for one user, opened if it does not exist yet. The
 * lookup carries the linking columns explicitly, so a lookup for null
 * matches an existing row rather than creating a second one.
 */
export async function ensureChat(
  kind: ChatKind,
  userId: string,
  options: { eventId?: string | null; adminId?: string | null } = {}
): Promise<{ id: string }> {
  const eventId = options.eventId ?? null
  const adminId = options.adminId ?? null

  const existing = await prisma.chat.findFirst({
    where: { kind, userId, eventId, adminId },
    select: { id: true },
  })
  if (existing) return existing

  return prisma.chat.create({
    data: { kind, userId, eventId, adminId },
    select: { id: true },
  })
}

/** Who may open a chat: its owner, or an administrator. An ADMIN chat
 *  belongs to the one administrator it was opened with. */
export function canOpenChat(
  chat: { kind: string; userId: string; adminId: string | null },
  viewer: ChatViewer
): boolean {
  if (chat.userId === viewer.id) return true
  if (!atLeast(viewer.role, 'ADMIN')) return false
  return chat.kind !== 'ADMIN' || chat.adminId === viewer.id
}

/** Whether this viewer may still write in the chat. */
export function canWriteInChat(
  chat: { userId: string; userReadOnly: boolean },
  viewer: ChatViewer
): boolean {
  if (atLeast(viewer.role, 'ADMIN')) return true
  if (chat.userId !== viewer.id) return false
  return !chat.userReadOnly
}

/** When one participant last read a chat, which is what the unread counts are worked out from. */
export async function markChatRead(chatId: string, userId: string): Promise<void> {
  await prisma.chatRead.upsert({
    where: { chatId_userId: { chatId, userId } },
    update: { lastReadAt: new Date() },
    create: { chatId, userId, lastReadAt: new Date() },
  })
}

/**
 * Writes one message of a SUPPORT or ADMIN chat, moves the chat to the
 * top of the list and raises the notification. A message written from the
 * Messages section is feedback too, so it is logged where the feedback
 * form's messages already are вЂ” pass `log: false` when the caller logs it
 * with an attachment instead.
 */
export async function postChatMessage(
  chatId: string,
  authorId: string,
  body: string,
  options: { log?: boolean } = {}
): Promise<ChatMessageView> {
  const message = await prisma.chatMessage.create({
    data: { chatId, authorId, body: sanitizeHtml(body) },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: authorSelect },
    },
  })
  await prisma.chat.update({
    where: { id: chatId },
    data: { lastMessageAt: message.createdAt },
  })

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      kind: true,
      userId: true,
      adminId: true,
      user: { select: { id: true, name: true } },
      admin: { select: { id: true, name: true } },
    },
  })

  const preview = plainPreview(message.body)
  const html = chat?.kind !== 'EVENT'
  const own = message.author.id === authorId

  if (chat?.kind === 'SUPPORT') {
    if (chat.userId === authorId) {
      // Feedback from the Messages section: every administrator hears of it.
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true },
      })
      await notifyUsers(
        admins
          .filter((admin) => admin.id !== authorId)
          .map((admin) => ({
            userId: admin.id,
            type: 'CHAT_MESSAGE' as const,
            title: chat.user.name,
            message: preview,
            targetType: 'CHAT' as const,
            targetId: chat.id,
            meta: { chatId: chat.id },
          }))
      )
      if (options.log !== false) {
        await logActivity({
          category: 'FEEDBACK',
          actorId: authorId,
          actorName: chat.user.name,
          message: message.body,
        })
      }
    } else {
      await notifyUser({
        userId: chat.userId,
        type: 'CHAT_MESSAGE',
        title: SUPPORT_DISPLAY_NAME,
        message: preview,
        targetType: 'CHAT',
        targetId: chat.id,
        meta: { chatId: chat.id },
      })
    }
  } else if (chat?.kind === 'ADMIN') {
    const fromUser = chat.userId === authorId
    const recipientId = fromUser ? chat.adminId : chat.userId
    // The row is named for whoever wrote the message, not for whoever
    // receives it: a personal message reaches the user under the
    // administrator's own name and the other way round.
    const title = fromUser ? chat.user.name : chat.admin?.name ?? SUPPORT_DISPLAY_NAME
    if (recipientId && recipientId !== authorId) {
      await notifyUser({
        userId: recipientId,
        type: 'CHAT_MESSAGE',
        title,
        message: preview,
        targetType: 'CHAT',
        targetId: chat.id,
        meta: { chatId: chat.id },
      })
    }
  }

  return {
    id: message.id,
    authorId: message.author.id,
    displayName: displayNameFor(chat?.kind ?? 'ADMIN', message.author, chat?.userId ?? ''),
    displayAvatar: displayAvatarFor(chat?.kind ?? 'ADMIN', message.author),
    html,
    body: message.body,
    own,
    createdAt: message.createdAt.toISOString(),
  }
}

/** What a message's author is called in the thread. */
function displayNameFor(
  kind: string,
  author: { id: string; name: string },
  chatUserId: string
): string {
  if (kind === 'SUPPORT' && author.id !== chatUserId) return SUPPORT_DISPLAY_NAME
  return author.name
}

function displayAvatarFor(
  kind: string,
  author: { id: string; avatar: string | null }
): string | null {
  if (kind === 'SUPPORT') return null
  return author.avatar
}

/**
 * A new comment moves the event's thread, so everyone whose Messages hold
 * that thread hears about it. The comment's own author hears nothing, and
 * neither does the author of the comment being answered, who already gets
 * the reply notification.
 */
export async function notifyEventThreads(
  eventId: string,
  eventTitle: string,
  authorId: string,
  replyRecipientId: string | null,
  preview: string
): Promise<void> {
  const chats = await prisma.chat.findMany({
    where: { kind: 'EVENT', eventId, userId: { not: authorId } },
    select: { id: true, userId: true },
  })
  // One insert for every holder of the thread rather than one each: a
  // comment on a popular event otherwise costs a round-trip per reader.
  await notifyUsers(
    chats
      .filter((chat) => chat.userId !== replyRecipientId)
      .map((chat) => ({
        userId: chat.userId,
        type: 'CHAT_MESSAGE' as const,
        title: eventTitle,
        message: preview,
        targetType: 'CHAT' as const,
        targetId: chat.id,
        meta: { chatId: chat.id },
      }))
  )
}

/** The event's comments, in the order its page shows them. */
export async function eventThreadMessages(
  eventId: string,
  viewer: ChatViewer
): Promise<ChatMessageView[]> {
  const viewerIsAdmin = atLeast(viewer.role, 'ADMIN')
  const comments = await prisma.eventComment.findMany({
    where: {
      eventId,
      deletedAt: null,
      ...(viewerIsAdmin ? {} : { banned: false }),
    },
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: authorSelect },
    },
    orderBy: [{ pinned: 'desc' }, { createdAt: 'asc' }],
    take: 300,
  })

  return comments.map((comment) => ({
    id: comment.id,
    authorId: comment.author.id,
    displayName: comment.author.name,
    displayAvatar: comment.author.avatar,
    html: false,
    body: comment.body,
    own: comment.author.id === viewer.id,
    createdAt: comment.createdAt.toISOString(),
  }))
}

/**
 * Unread counts for a set of chats, in one round-trip. Each chat's
 * cutoff is its own read state вЂ” the moment the reader last looked вЂ” which
 * a per-chat query cannot express, so the two counts are correlated
 * subqueries joined against the reader's read marker.
 */
async function unreadCounts(
  viewerId: string,
  chatIds: string[]
): Promise<Map<string, number>> {
  if (chatIds.length === 0) return new Map()
  const rows = await prisma.$queryRaw<{ chatId: string; unread: number }[]>`
    SELECT c."id" AS "chatId", (
        SELECT COUNT(*)::int FROM "ChatMessage" m
        WHERE m."chatId" = c."id"
          AND m."authorId" <> ${viewerId}
          AND m."createdAt" > COALESCE(r."lastReadAt", c."createdAt")
      ) + (
        SELECT COUNT(*)::int FROM "EventComment" cm
        WHERE c."kind" = 'EVENT'
          AND cm."eventId" = c."eventId"
          AND cm."authorId" <> ${viewerId}
          AND cm."banned" = false
          AND cm."deletedAt" IS NULL
          AND cm."createdAt" > COALESCE(r."lastReadAt", c."createdAt")
      ) AS "unread"
    FROM "Chat" c
    LEFT JOIN "ChatRead" r ON r."chatId" = c."id" AND r."userId" = ${viewerId}
    WHERE c."id" IN (${Prisma.join(chatIds)})
  `
  return new Map(rows.map((row) => [row.chatId, row.unread]))
}

/**
 * Every chat this viewer takes part in, newest first. A regular user sees
 * their own feedback chat, their conversations and the event threads they
 * started. An administrator sees the feedback inbox, the conversations
 * they opened, and every event thread.
 */
export async function listChats(viewer: ChatViewer): Promise<ChatSummary[]> {
  if (isGuest(viewer.role)) return []
  const viewerIsAdmin = atLeast(viewer.role, 'ADMIN')

  const rows = (await prisma.chat.findMany({
    where: viewerIsAdmin
      ? { OR: [{ kind: { not: 'ADMIN' } }, { kind: 'ADMIN', adminId: viewer.id }] }
      : { userId: viewer.id },
    select: chatInclude,
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  })) as unknown as ChatRow[]

  // An event's thread hides with the event: one that has since been
  // unpublished or taken out of this viewer's reach is not listed.
  const eventIds = [
    ...new Set(
      rows
        .filter((r) => r.kind === 'EVENT' && r.eventId)
        .map((r) => r.eventId as string)
    ),
  ]
  const visibleEventIds = new Set<string>(eventIds)
  if (!viewerIsAdmin) {
    visibleEventIds.clear()
    for (const eventId of eventIds) {
      try {
        await loadEventForComments(eventId, viewer)
        visibleEventIds.add(eventId)
      } catch {
        // Unpublished or out of reach, so its thread is not this
        // viewer's to open either.
      }
    }
  }

  const visibleRows = rows.filter(
    (r) => r.kind !== 'EVENT' || !r.eventId || visibleEventIds.has(r.eventId)
  )
  const unreadByChat = await unreadCounts(
    viewer.id,
    visibleRows.map((r) => r.id)
  )

  // The last comment of every event thread, for the previews.
  const eventRows = visibleRows.filter((r) => r.kind === 'EVENT' && r.eventId)
  const lastCommentByEvent = new Map<string, { body: string; authorId: string; createdAt: Date }>()
  if (eventRows.length > 0) {
    const comments = await prisma.eventComment.findMany({
      where: {
        eventId: { in: [...new Set(eventRows.map((r) => r.eventId as string))] },
        deletedAt: null,
        banned: false,
      },
      select: { eventId: true, body: true, authorId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    for (const comment of comments) {
      if (!lastCommentByEvent.has(comment.eventId)) {
        lastCommentByEvent.set(comment.eventId, comment)
      }
    }
  }

  const summaries: ChatSummary[] = []
  for (const row of visibleRows) {
    const isOwner = row.userId === viewer.id
    const lastComment = row.eventId ? lastCommentByEvent.get(row.eventId) : undefined
    const unread = unreadByChat.get(row.id) ?? 0

    const preview =
      row.kind === 'EVENT'
        ? lastComment
          ? plainPreview(lastComment.body)
          : null
        : row.messages[0]
          ? plainPreview(row.messages[0].body)
          : null

    const lastMessageAt =
      row.kind === 'EVENT' && lastComment && lastComment.createdAt > row.lastMessageAt
        ? lastComment.createdAt
        : row.lastMessageAt

    let title: string
    let avatar: string | null = null
    let subtitle: string | null = null
    let counterpartId: string | null = null
    let counterpartRole: string | null = null

    if (!isOwner) {
      // The administrator's side: the person to answer.
      title = row.user.name
      avatar = row.user.avatar
      counterpartId = row.user.id
      counterpartRole = row.user.role
      if (row.kind === 'EVENT' && row.event) subtitle = row.event.title
    } else if (row.kind === 'SUPPORT') {
      title = SUPPORT_DISPLAY_NAME
      avatar = null
    } else if (row.kind === 'ADMIN' && row.admin) {
      title = row.admin.name
      avatar = row.admin.avatar
      counterpartId = row.admin.id
      counterpartRole = 'ADMIN'
    } else {
      title = row.event?.title ?? 'вЂ”'
      avatar = null
    }

    summaries.push({
      id: row.id,
      kind: row.kind as ChatKind,
      title,
      avatar,
      subtitle,
      counterpartId,
      counterpartRole,
      eventId: row.eventId,
      eventKey: row.event?.key ?? null,
      preview,
      lastMessageAt: lastMessageAt.toISOString(),
      unread,
      canWrite: canWriteInChat(row, viewer),
      userReadOnly: row.userReadOnly,
    })
  }

  return summaries
}

/** One chat with its thread, for the message view. */
export interface ChatThread {
  chat: ChatSummary
  messages: ChatMessageView[]
  viewerIsAdmin: boolean
}

/** Loads one chat with its messages; the caller checks access first. */
export async function loadThread(
  chatId: string,
  viewer: ChatViewer
): Promise<ChatThread> {
  const viewerIsAdmin = atLeast(viewer.role, 'ADMIN')
  const row = (await prisma.chat.findUnique({
    where: { id: chatId },
    select: chatInclude,
  })) as unknown as ChatRow | null
  if (!row) {
    throw new Error('Chat not found')
  }

  // An event's thread is as open as the event itself: unpublishing it, the
  // start-time rule, or losing the visibility tags takes the thread away
  // too, not just the page. Administrators see every thread.
  if (row.kind === 'EVENT' && row.eventId && !viewerIsAdmin) {
    await loadEventForComments(row.eventId, viewer)
  }

  let messages: ChatMessageView[] = []
  if (row.kind === 'EVENT' && row.eventId) {
    messages = await eventThreadMessages(row.eventId, viewer)
  } else {
    const rows = await prisma.chatMessage.findMany({
      where: { chatId },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: authorSelect },
      },
      orderBy: { createdAt: 'asc' },
      take: 300,
    })
    messages = rows.map((message) => ({
      id: message.id,
      authorId: message.author.id,
      displayName: displayNameFor(row.kind, message.author, row.userId),
      displayAvatar: displayAvatarFor(row.kind, message.author),
      html: true,
      body: message.body,
      own: message.author.id === viewer.id,
      createdAt: message.createdAt.toISOString(),
    }))
  }

  const isOwner = row.userId === viewer.id
  const title = !isOwner
    ? row.user.name
    : row.kind === 'SUPPORT'
      ? SUPPORT_DISPLAY_NAME
      : row.kind === 'ADMIN' && row.admin
        ? row.admin.name
        : row.event?.title ?? 'вЂ”'
  const avatar =
    row.kind === 'SUPPORT' || row.kind === 'EVENT'
      ? row.user.avatar && !isOwner
        ? row.user.avatar
        : null
      : isOwner
        ? row.admin?.avatar ?? null
        : row.user.avatar

  const last = messages[messages.length - 1]

  return {
    chat: {
      id: row.id,
      kind: row.kind as ChatKind,
      title,
      avatar,
      subtitle:
        !isOwner && row.kind === 'EVENT' && row.event ? row.event.title : null,
      counterpartId: isOwner ? row.adminId : row.userId,
      counterpartRole: isOwner ? (row.adminId ? 'ADMIN' : null) : row.user.role,
      eventId: row.eventId,
      eventKey: row.event?.key ?? null,
      preview: last ? plainPreview(last.body) : null,
      lastMessageAt: row.lastMessageAt.toISOString(),
      unread: 0,
      canWrite: canWriteInChat(row, viewer),
      userReadOnly: row.userReadOnly,
    },
    messages,
    viewerIsAdmin,
  }
}
