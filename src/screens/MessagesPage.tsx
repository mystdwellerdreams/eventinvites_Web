import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '../context/AuthContext'
import { useI18n } from '../i18n'
import { apiErrorMessage, chatsAPI, usersAPI } from '../utils/api'
import { isGuest } from '../utils/roles'
import UserAvatar from '../components/UserAvatar'
import type {
  ChatKind,
  ChatMessage,
  ChatSummary,
  ChatThreadResponse,
  User,
} from '../types'
import './MessagesPage.css'

/** How often an open conversation refreshes itself. */
const POLL_MS = 15000

/** Feedback, personal conversations and event threads, in that order. */
const CATEGORIES: ChatKind[] = ['SUPPORT', 'ADMIN', 'EVENT']

/**
 * The Messages section: a messenger for the conversations this account
 * takes part in. Feedback chats are answered as Technical Support, a
 * personal conversation names its administrator, and an event thread
 * mirrors the comments on the event's page. A conversation appears on its
 * own — feedback sent, an administrator writing first, or a comment on an
 * event — because a regular user can never start one.
 */
export default function MessagesPage({ initialChatId }: { initialChatId?: string }) {
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const router = useRouter()

  const [chats, setChats] = useState<ChatSummary[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [activeId, setActiveId] = useState<string | null>(initialChatId ?? null)
  const [thread, setThread] = useState<ChatThreadResponse | null>(null)
  const [threadLoading, setThreadLoading] = useState(Boolean(initialChatId))
  const [threadError, setThreadError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')

  // The administrator's new-conversation picker.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerUsers, setPickerUsers] = useState<User[]>([])
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerLoading, setPickerLoading] = useState(false)

  const feedRef = useRef<HTMLDivElement>(null)
  const guest = isGuest(user)
  const admin = user?.role === 'ADMIN'

  /* --------------------------------- loading -------------------------------- */

  const loadChats = useCallback(async () => {
    if (!user || guest) {
      setListLoading(false)
      return
    }
    try {
      const response = await chatsAPI.list()
      setChats(response.data.chats)
      setListError('')
    } catch (err) {
      setListError(apiErrorMessage(err, t('messages.listFailed')))
    } finally {
      setListLoading(false)
    }
  }, [user, guest, t])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  /** Loads one conversation, quietly when it is only refreshing. */
  const loadThread = useCallback(
    async (id: string, quiet = false) => {
      if (!quiet) {
        setThreadLoading(true)
        setThreadError('')
      }
      try {
        const response = await chatsAPI.thread(id)
        setThread(response.data)
      } catch (err) {
        if (!quiet) setThreadError(apiErrorMessage(err, t('messages.loadFailed')))
      } finally {
        if (!quiet) setThreadLoading(false)
      }
    },
    [t]
  )

  const openChat = useCallback(
    async (id: string) => {
      setActiveId(id)
      await loadThread(id)
      // Opening read the conversation on the server, so the list's unread
      // counts can be refreshed straight away.
      await loadChats()
      // The URL keeps step, so a notification can deep-link the chat and
      // the browser's back button walks out of it again.
      router.replace(`/messages?chat=${id}`)
    },
    [loadThread, loadChats, router]
  )

  // A deep link opens its conversation once the list has arrived.
  const deepLinkHandled = useRef<string | null>(null)
  useEffect(() => {
    if (!initialChatId || listLoading || guest || !user) return
    if (deepLinkHandled.current === initialChatId) return
    deepLinkHandled.current = initialChatId
    void loadThread(initialChatId)
    void loadChats()
  }, [initialChatId, listLoading, guest, user, loadThread, loadChats])

  // An open conversation and the chat list keep themselves current.
  useEffect(() => {
    if (!user || guest) return
    const timer = window.setInterval(() => {
      void loadChats()
      if (activeId) void loadThread(activeId, true)
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [user, guest, activeId, loadChats, loadThread])

  // A new message scrolls the feed to the bottom, the way a messenger does.
  const messageCount = thread?.messages.length ?? 0
  useEffect(() => {
    if (!messageCount) return
    const feed = feedRef.current
    if (feed) feed.scrollTop = feed.scrollHeight
  }, [messageCount, activeId])

  /* --------------------------------- writing -------------------------------- */

  const send = async () => {
    const body = draft.trim()
    if (!body || !activeId || sending) return
    setSending(true)
    try {
      const response = await chatsAPI.send(activeId, body)
      setThread((current) =>
        current
          ? { ...current, messages: [...current.messages, response.data.message] }
          : current
      )
      setDraft('')
      await loadChats()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('messages.sendFailed')))
    } finally {
      setSending(false)
    }
  }

  const onDraftKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter starts a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void send()
    }
  }

  /** Whether the composer accepts a message, and why not when it does not. */
  const writeBlock = (): string | null => {
    if (guest) return t('messages.guestReadOnly')
    if (!thread) return null
    if (admin) return null
    if (thread.chat.userReadOnly) return t('messages.readOnly')
    if (!thread.chat.canWrite) return t('messages.readOnly')
    return null
  }

  const toggleReadOnly = async () => {
    if (!activeId || !thread) return
    const readOnly = !thread.chat.userReadOnly
    try {
      await chatsAPI.setReadOnly(activeId, readOnly)
      setThread((current) =>
        current
          ? { ...current, chat: { ...current.chat, userReadOnly: readOnly } }
          : current
      )
      setNotice(
        readOnly ? t('messages.readOnlySet') : t('messages.readOnlyLifted')
      )
      window.setTimeout(() => setNotice(''), 4000)
      await loadChats()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('messages.readOnlyFailed')))
    }
  }

  /* ------------------------------ conversations ----------------------------- */

  const openPicker = async () => {
    setPickerOpen(true)
    if (pickerUsers.length > 0) return
    setPickerLoading(true)
    try {
      const response = await usersAPI.getAll()
      setPickerUsers(response.data.users ?? [])
    } catch (err) {
      window.alert(apiErrorMessage(err, t('messages.newChatFailed')))
    } finally {
      setPickerLoading(false)
    }
  }

  const startConversation = async (userId: string) => {
    try {
      const response = await chatsAPI.open({ userId, kind: 'ADMIN' })
      setPickerOpen(false)
      await loadChats()
      await openChat(response.data.chat.id)
    } catch (err) {
      window.alert(apiErrorMessage(err, t('messages.newChatFailed')))
    }
  }

  /* ---------------------------------- views --------------------------------- */

  const visibleChats = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return chats
    return chats.filter((chat) => chat.title.toLowerCase().includes(q))
  }, [chats, query])

  const grouped = useMemo(() => {
    const groups: { kind: ChatKind; items: ChatSummary[] }[] = []
    for (const kind of CATEGORIES) {
      const items = visibleChats.filter((chat) => chat.kind === kind)
      if (items.length > 0) groups.push({ kind, items })
    }
    return groups
  }, [visibleChats])

  const timeOf = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
      new Date(iso)
    )

  const dayKeyOf = (iso: string) => new Date(iso).toDateString()

  const dayLabelOf = (iso: string) => {
    const date = new Date(iso)
    const today = new Date()
    const yesterday = new Date(today.getTime() - 86400000)
    if (date.toDateString() === today.toDateString()) return t('messages.today')
    if (date.toDateString() === yesterday.toDateString()) return t('messages.yesterday')
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date)
  }

  const categoryLabel = (kind: ChatKind) =>
    kind === 'SUPPORT'
      ? t('messages.category.support')
      : kind === 'ADMIN'
        ? t('messages.category.conversations')
        : t('messages.category.events')

  const kindIcon = (kind: ChatKind) =>
    kind === 'SUPPORT' ? '🛟' : kind === 'ADMIN' ? '👤' : '📅'

  /* --------------------------------- render --------------------------------- */

  if (!user) {
    return (
      <div className="messages-page">
        <h1>{t('messages.title')}</h1>
        <p className="messages-notice">{t('messages.loginRequired')}</p>
      </div>
    )
  }

  if (guest) {
    return (
      <div className="messages-page">
        <h1>{t('messages.title')}</h1>
        <p className="messages-notice">{t('messages.unavailable')}</p>
      </div>
    )
  }

  const composerBlocked = writeBlock()

  return (
    <div className={`messages-page ${activeId ? 'has-active' : ''}`}>
      <aside className="messages-side">
        <header className="messages-side-head">
          <h1>{t('messages.title')}</h1>
          {admin && (
            <button
              type="button"
              className="messages-new"
              onClick={() => void openPicker()}
              title={t('messages.newChat')}
              aria-label={t('messages.newChat')}
            >
              +
            </button>
          )}
        </header>

        <input
          type="search"
          className="messages-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('messages.searchPlaceholder')}
          aria-label={t('messages.searchPlaceholder')}
        />

        {listLoading ? (
          <p className="messages-side-status">{t('users.loading')}</p>
        ) : listError ? (
          <p className="messages-side-status is-error">{listError}</p>
        ) : grouped.length === 0 ? (
          <div className="messages-empty-side">
            <p className="messages-side-status">{t('messages.empty')}</p>
            <p className="messages-side-hint">{t('messages.emptyHint')}</p>
          </div>
        ) : (
          <div className="messages-groups">
            {grouped.map((group) => (
              <section key={group.kind} className="messages-group">
                <h2 className="messages-group-label">{categoryLabel(group.kind)}</h2>
                <ul className="messages-list">
                  {group.items.map((chat) => (
                    <li key={chat.id}>
                      <button
                        type="button"
                        className={`messages-item ${activeId === chat.id ? 'is-active' : ''}`}
                        onClick={() => void openChat(chat.id)}
                      >
                        <span className="messages-item-avatar">
                          {chat.kind === 'SUPPORT' ? (
                            <span className="messages-support-badge" aria-hidden="true">
                              🛟
                            </span>
                          ) : (
                            <UserAvatar
                              name={chat.title}
                              avatar={chat.avatar}
                              size={44}
                            />
                          )}
                        </span>
                        <span className="messages-item-body">
                          <span className="messages-item-top">
                            <span className="messages-item-name">
                              {chat.kind === 'SUPPORT'
                                ? t('messages.supportAlias')
                                : chat.title}
                            </span>
                            <time dateTime={chat.lastMessageAt}>
                              {timeOf(chat.lastMessageAt)}
                            </time>
                          </span>
                          <span className="messages-item-bottom">
                            <span className="messages-item-preview">
                              {chat.preview ?? chat.subtitle ?? ''}
                            </span>
                            {chat.unread > 0 && (
                              <span className="messages-item-unread">
                                {chat.unread > 99 ? '99+' : chat.unread}
                              </span>
                            )}
                            {chat.userReadOnly && (
                              <span
                                className="messages-item-lock"
                                title={t('messages.readOnly')}
                                aria-hidden="true"
                              >
                                🔇
                              </span>
                            )}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </aside>

      <section className="messages-thread">
        {!activeId ? (
          <div className="messages-thread-placeholder">
            <span aria-hidden="true">💬</span>
            <p>{t('messages.emptyHint')}</p>
          </div>
        ) : threadLoading && !thread ? (
          <div className="messages-thread-placeholder">
            <div className="spinner" />
            <p>{t('users.loading')}</p>
          </div>
        ) : threadError && !thread ? (
          <div className="messages-thread-placeholder">
            <p className="is-error">{threadError}</p>
          </div>
        ) : thread ? (
          <>
            <header className="messages-head">
              <button
                type="button"
                className="messages-back"
                onClick={() => {
                  setActiveId(null)
                  setThread(null)
                  router.replace('/messages')
                }}
                aria-label={t('messages.back')}
              >
                ‹
              </button>
              {thread.chat.kind === 'SUPPORT' ? (
                <span
                  className="messages-support-badge is-large"
                  aria-hidden="true"
                >
                  🛟
                </span>
              ) : (
                <UserAvatar
                  name={thread.chat.title}
                  avatar={thread.chat.avatar}
                  size={40}
                />
              )}
              <div className="messages-head-body">
                <h2>
                  {thread.chat.kind === 'SUPPORT'
                    ? t('messages.supportAlias')
                    : thread.chat.title}
                </h2>
                <p>
                  {thread.chat.subtitle ??
                    (thread.chat.kind === 'EVENT'
                      ? t('messages.eventThread')
                      : categoryLabel(thread.chat.kind))}
                </p>
              </div>
              {thread.chat.eventKey && (
                <Link
                  className="messages-head-link"
                  href={`/events/key/${thread.chat.eventKey}`}
                >
                  {t('messages.openEventPage')}
                </Link>
              )}
              {admin && (
                <button
                  type="button"
                  className="messages-head-action"
                  onClick={() => void toggleReadOnly()}
                  title={
                    thread.chat.userReadOnly
                      ? t('messages.readOnlyOff')
                      : t('messages.readOnlyOn')
                  }
                >
                  {thread.chat.userReadOnly
                    ? t('messages.readOnlyOff')
                    : t('messages.readOnlyOn')}
                </button>
              )}
            </header>

            {notice && <p className="messages-status">{notice}</p>}

            <div className="messages-feed" ref={feedRef}>
              {thread.messages.map((message, index) => {
                const previous = thread.messages[index - 1]
                const showDay = !previous || dayKeyOf(previous.createdAt) !== dayKeyOf(message.createdAt)
                const showAuthor =
                  !previous ||
                  previous.authorId !== message.authorId ||
                  previous.displayName !== message.displayName ||
                  showDay
                return (
                  <div key={message.id}>
                    {showDay && (
                      <p className="messages-day">{dayLabelOf(message.createdAt)}</p>
                    )}
                    <MessageBubble
                      message={message}
                      showAuthor={showAuthor}
                      timeOf={timeOf}
                      youLabel={t('messages.you')}
                    />
                  </div>
                )
              })}
            </div>

            {thread.chat.kind === 'EVENT' && (
              <p className="messages-note">{t('messages.commentsNote')}</p>
            )}

            {composerBlocked ? (
              <p className="messages-composer-blocked">{composerBlocked}</p>
            ) : (
              <div className="messages-composer">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onDraftKeyDown}
                  placeholder={
                    thread.messages.length === 0
                      ? t('messages.firstMessage')
                      : t('messages.placeholder')
                  }
                  rows={1}
                  aria-label={t('messages.placeholder')}
                />
                <button
                  type="button"
                  className="messages-send"
                  onClick={() => void send()}
                  disabled={sending || !draft.trim()}
                  aria-label={t('messages.send')}
                >
                  {sending ? t('messages.sending') : t('messages.send')}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="messages-thread-placeholder">
            <span aria-hidden="true">{kindIcon('ADMIN')}</span>
          </div>
        )}
      </section>

      {pickerOpen && (
        <div className="messages-picker-overlay" onClick={() => setPickerOpen(false)}>
          <div
            className="messages-picker"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('messages.newChat')}
          >
            <header className="messages-picker-head">
              <h2>{t('messages.newChat')}</h2>
              <button
                type="button"
                className="messages-picker-close"
                onClick={() => setPickerOpen(false)}
                aria-label={t('nav.close')}
              >
                ✕
              </button>
            </header>
            <p className="messages-picker-hint">{t('messages.newChatHint')}</p>
            <input
              type="search"
              className="messages-search"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder={t('messages.searchPlaceholder')}
              aria-label={t('messages.searchPlaceholder')}
            />
            {pickerLoading ? (
              <p className="messages-side-status">{t('users.loading')}</p>
            ) : (
              <ul className="messages-picker-list">
                {pickerUsers
                  .filter((candidate) =>
                    candidate.name.toLowerCase().includes(pickerQuery.trim().toLowerCase())
                  )
                  .map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className="messages-item"
                        onClick={() => void startConversation(candidate.id)}
                      >
                        <span className="messages-item-avatar">
                          <UserAvatar
                            name={candidate.name}
                            avatar={candidate.avatar}
                            size={40}
                          />
                        </span>
                        <span className="messages-item-body">
                          <span className="messages-item-top">
                            <span className="messages-item-name">{candidate.name}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/** One message bubble, grouped under the author's name when it changes. */
function MessageBubble({
  message,
  showAuthor,
  timeOf,
  youLabel,
}: {
  message: ChatMessage
  showAuthor: boolean
  timeOf: (iso: string) => string
  youLabel: string
}) {
  return (
    <article className={`msg ${message.own ? 'is-own' : ''}`}>
      {showAuthor && (
        <p className="msg-author">
          {message.own ? youLabel : message.displayName}
        </p>
      )}
      <div className={`msg-bubble ${message.own ? 'is-own' : ''}`}>
        {message.html ? (
          <div
            className="rte-content"
            dangerouslySetInnerHTML={{ __html: message.body }}
          />
        ) : (
          <p className="msg-text">{message.body}</p>
        )}
        <time className="msg-time" dateTime={message.createdAt}>
          {timeOf(message.createdAt)}
        </time>
      </div>
    </article>
  )
}
