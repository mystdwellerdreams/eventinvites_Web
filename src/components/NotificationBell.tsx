import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { notificationsAPI } from '../utils/api'
import { NOTIFICATIONS_REFRESH_EVENT } from '../utils/nativePush'
import { useAuth } from '../context/AuthContext'
import { useAuthModal } from '../context/AuthModalContext'
import { useI18n } from '../i18n'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type {
  BroadcastNotificationItem,
  BroadcastNotificationType,
  IndividualNotificationItem,
  IndividualNotificationType,
  NotificationsResponse,
} from '../types'

/** One row in the panel, whichever kind it is. */
type Entry =
  | { kind: 'broadcast'; item: BroadcastNotificationItem }
  | { kind: 'individual'; item: IndividualNotificationItem }

const BROADCAST_ICONS: Record<BroadcastNotificationType, string> = {
  EVENT_CREATED: '📅',
  EVENT_REMINDER: '⏰',
  ORGANIZER_UPDATE: '📣',
  ANNOUNCEMENT: '🖼️',
}

const INDIVIDUAL_ICONS: Record<IndividualNotificationType, string> = {
  COMMENT_REPLY: '💬',
  COMMENT_BAN: '🚫',
  COMMENT_BLOCK: '⛔',
  ADMIN_MESSAGE: '✉️',
  CHAT_MESSAGE: '💬',
  REGISTRATION_CONFIRMED: '✅',
  LIST_TRANSFER: '📋',
  LIST_REMOVAL: '➖',
  PASSWORD_RESET: '🔑',
  PASSWORD_ADVICE: '🔐',
}

/** Seconds between background refreshes while the panel is open. */
const POLL_MS = 60000

/** A one-line preview of an HTML message body. */
const stripHtml = (html: string) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The bell in the header. Broadcasts and per-user notifications sit in one
 * list, newest first; each row leads where it belongs, can be marked read,
 * and can be deleted — which hides a broadcast for this user but removes an
 * individual one for good.
 */
export default function NotificationBell() {
  const { t, locale } = useI18n()
  const { user } = useAuth()
  const { open: openAuth } = useAuthModal()
  const router = useRouter()
  const isPortrait = useMediaQuery('(orientation: portrait)')

  const [panelOpen, setPanelOpen] = useState(false)
  const [data, setData] = useState<NotificationsResponse | null>(null)
  const [messageItem, setMessageItem] = useState<IndividualNotificationItem | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await notificationsAPI.list()
      setData(data)
    } catch {
      // A failed refresh leaves the previous list in place.
    }
  }, [user])

  useEffect(() => {
    void load()
  // The list is refreshed on every sign-in, which is when it can change.
  }, [load, user?.id])

  // While the panel is open it keeps itself up to date.
  useEffect(() => {
    if (!panelOpen || !user) return
    const timer = window.setInterval(() => void load(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [panelOpen, user, load])

  // A push that arrived, or a notification opened from one, changes the list,
  // so the Android bridge asks for a reload here.
  useEffect(() => {
    const onRefresh = () => void load()
    window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, onRefresh)
  }, [load])

  // Outside click and Escape close the panel.
  useEffect(() => {
    if (!panelOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPanelOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPanelOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [panelOpen])

  const entries: Entry[] = []
  if (data) {
    for (const item of data.broadcasts) entries.push({ kind: 'broadcast', item })
    for (const item of data.individual) entries.push({ kind: 'individual', item })
    entries.sort(
      (a, b) => new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime()
    )
  }

  const unread = data ? data.unreadBroadcasts + data.unreadIndividual : 0

  /** Where a row leads when opened. */
  const run = (entry: Entry) => {
    if (entry.kind === 'broadcast') {
      if (entry.item.sourceType === 'EVENT') {
        router.push(`/events/${entry.item.sourceId}`)
        return true
      }
      // An announcement lives on the home page, in the banner.
      router.push('/#announcements')
      return true
    }

    const item = entry.item
    if (item.type === 'COMMENT_REPLY') {
      const eventId = item.meta ? String(item.meta.eventId ?? '') : ''
      if (eventId && item.targetId) {
        router.push(`/events/${eventId}#comment-${item.targetId}`)
        return true
      }
      return false
    }
    if (item.type === 'ADMIN_MESSAGE') {
      // A message written in a conversation opens that conversation;
      // older ones, without a chat to show, open in a panel instead.
      const chatId = item.meta ? String(item.meta.chatId ?? '') : ''
      if (chatId) {
        router.push(`/messages?chat=${chatId}`)
        return true
      }
      // The message opens in a panel rather than leaving the page.
      setMessageItem(item)
      return true
    }
    if (item.type === 'CHAT_MESSAGE') {
      const chatId = item.meta ? String(item.meta.chatId ?? '') : ''
      if (chatId) {
        router.push(`/messages?chat=${chatId}`)
        return true
      }
      return false
    }
    if (item.type === 'PASSWORD_RESET' || item.type === 'PASSWORD_ADVICE') {
      // Nothing to open: the password is changed where the link leads.
      return false
    }
    if (item.targetType === 'EVENT' && item.targetId) {
      router.push(`/events/${item.targetId}`)
      return true
    }
    return false
  }

  const openEntry = async (entry: Entry) => {
    const { item } = entry
    if (!item.readAt && busyId === null) {
      setBusyId(item.id)
      try {
        if (entry.kind === 'broadcast') {
          await notificationsAPI.readBroadcast(item.id)
          setData((current) =>
            current
              ? {
                  ...current,
                  unreadBroadcasts: Math.max(0, current.unreadBroadcasts - 1),
                  broadcasts: current.broadcasts.map((b) =>
                    b.id === item.id ? { ...b, readAt: new Date().toISOString() } : b
                  ),
                }
              : current
          )
        } else {
          await notificationsAPI.read(item.id)
          setData((current) =>
            current
              ? {
                  ...current,
                  unreadIndividual: Math.max(0, current.unreadIndividual - 1),
                  individual: current.individual.map((n) =>
                    n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n
                  ),
                }
              : current
          )
        }
      } catch {
        // The row stays unread; the click still does its job.
      } finally {
        setBusyId(null)
      }
    }
    run(entry)
  }

  const removeEntry = async (entry: Entry, e: React.MouseEvent) => {
    e.stopPropagation()
    const { item } = entry
    setBusyId(item.id)
    try {
      if (entry.kind === 'broadcast') {
        // Hiding: the notification leaves this user's list, not the system.
        await notificationsAPI.hideBroadcast(item.id)
        setData((current) =>
          current
            ? { ...current, broadcasts: current.broadcasts.filter((b) => b.id !== item.id) }
            : current
        )
      } else {
        await notificationsAPI.remove(item.id)
        setData((current) =>
          current
            ? { ...current, individual: current.individual.filter((n) => n.id !== item.id) }
            : current
        )
      }
    } catch {
      // A failed removal leaves the row where it is.
    } finally {
      setBusyId(null)
    }
  }

  const markOneRead = async (entry: Entry, e: React.MouseEvent) => {
    e.stopPropagation()
    const { item } = entry
    if (item.readAt) return
    try {
      if (entry.kind === 'broadcast') {
        await notificationsAPI.readBroadcast(item.id)
        setData((current) =>
          current
            ? {
                ...current,
                unreadBroadcasts: Math.max(0, current.unreadBroadcasts - 1),
                broadcasts: current.broadcasts.map((b) =>
                  b.id === item.id ? { ...b, readAt: new Date().toISOString() } : b
                ),
              }
            : current
        )
      } else {
        await notificationsAPI.read(item.id)
        setData((current) =>
          current
            ? {
                ...current,
                unreadIndividual: Math.max(0, current.unreadIndividual - 1),
                individual: current.individual.map((n) =>
                  n.id === item.id ? { ...n, readAt: new Date().toISOString() } : n
                ),
              }
            : current
        )
      }
    } catch {
      // Nothing to do: the row simply stays unread.
    }
  }

  const markAll = async () => {
    try {
      await notificationsAPI.readAll()
      const now = new Date().toISOString()
      setData((current) =>
        current
          ? {
              ...current,
              unreadBroadcasts: 0,
              unreadIndividual: 0,
              broadcasts: current.broadcasts.map((b) => ({ ...b, readAt: b.readAt ?? now })),
              individual: current.individual.map((n) => ({ ...n, readAt: n.readAt ?? now })),
            }
          : current
      )
    } catch {
      // A failed "mark all" is followed by the next refresh.
    }
  }

  const labelFor = (entry: Entry): string => {
    if (entry.kind === 'broadcast') {
      return t(`notif.broadcast.${entry.item.type}`)
    }
    return t(`notif.kind.${entry.item.type}`)
  }

  const detailFor = (entry: Entry): string => {
    if (entry.kind === 'broadcast') {
      if (entry.item.type === 'ANNOUNCEMENT') {
        const adType = entry.item.meta ? String(entry.item.meta.adType ?? '') : ''
        return adType ? t(`banner.type.${adType}`) : ''
      }
      if (entry.item.type === 'ORGANIZER_UPDATE') {
        const updateTitle = entry.item.meta ? String(entry.item.meta.updateTitle ?? '') : ''
        return updateTitle
      }
      if (entry.item.type === 'EVENT_REMINDER') {
        const startsAt = entry.item.meta ? String(entry.item.meta.startsAt ?? '') : ''
        if (startsAt) {
          return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(startsAt)
          )
        }
        return ''
      }
      return ''
    }
    if (entry.item.type === 'LIST_TRANSFER' || entry.item.type === 'LIST_REMOVAL') {
      const listName = entry.item.meta ? String(entry.item.meta.listName ?? '') : ''
      return listName
    }
    if (entry.item.type === 'COMMENT_BLOCK') {
      const reason = entry.item.meta ? String(entry.item.meta.reason ?? '') : ''
      return reason
    }
    if (entry.item.type === 'PASSWORD_ADVICE') {
      // The advice itself is the point of the notification, so it is on the
      // row rather than behind a click.
      return t('notifications.passwordAdvice')
    }
    if (entry.item.type === 'ADMIN_MESSAGE' || entry.item.type === 'CHAT_MESSAGE') {
      return entry.item.message ? stripHtml(entry.item.message) : ''
    }
    return ''
  }

  const timeFor = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))

  return (
    <div className="notif" ref={wrapRef}>
      <button
        type="button"
        className="notif-button"
        onClick={() => {
          if (!user) {
            openAuth('login')
            return
          }
          setPanelOpen((o) => !o)
          void load()
        }}
        aria-label={t('notifications.title')}
        aria-expanded={panelOpen}
        aria-haspopup="menu"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="notif-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>

      {panelOpen && user && (
        <div className="notif-panel" role="dialog" aria-label={t('notifications.title')}>
          <div className="notif-panel-head">
            <p className="notif-head">{t('notifications.title')}</p>
            <button type="button" className="notif-mark-all" onClick={() => void markAll()}>
              {t('notifications.markAll')}
            </button>
          </div>

          {entries.length === 0 ? (
            <p className="notif-empty">{t('notifications.empty')}</p>
          ) : (
            <ul className="notif-list">
              {entries.map((entry) => {
                const { item } = entry
                const detail = detailFor(entry)
                return (
                  <li key={`${entry.kind}:${item.id}`}>
                    <div
                      className={`notif-row ${item.readAt ? '' : 'is-unread'}`}
                      onClick={() => void openEntry(entry)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          void openEntry(entry)
                        }
                      }}
                    >
                      <span className="notif-icon" aria-hidden="true">
                        {entry.kind === 'broadcast'
                          ? BROADCAST_ICONS[entry.item.type]
                          : INDIVIDUAL_ICONS[entry.item.type]}
                      </span>
                      <div className="notif-row-body">
                        <span className="notif-row-kind">{labelFor(entry)}</span>
                        {item.title && <span className="notif-row-title">{item.title}</span>}
                        {detail && <span className="notif-row-detail">{detail}</span>}
                        <time className="notif-row-time" dateTime={item.createdAt}>
                          {timeFor(item.createdAt)}
                        </time>
                      </div>
                      {!item.readAt && <span className="notif-dot" aria-label={t('notifications.unread')} />}
                      <span className="notif-row-actions">
                        {!item.readAt && (
                          <button
                            type="button"
                            className="notif-row-action"
                            aria-label={t('notifications.markRead')}
                            title={t('notifications.markRead')}
                            disabled={busyId === item.id}
                            onClick={(e) => void markOneRead(entry, e)}
                          >
                            ✓
                          </button>
                        )}
                        <button
                          type="button"
                          className="notif-row-action is-danger"
                          aria-label={t('notifications.delete')}
                          title={t('notifications.delete')}
                          disabled={busyId === item.id}
                          onClick={(e) => void removeEntry(entry, e)}
                        >
                          🗑
                        </button>
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* An administrator's message: a panel beside the page on a wide screen,
          centred over it on a narrow one. */}
      {messageItem && (
        <div className="notif-message-overlay" onClick={() => setMessageItem(null)}>
          <div
            className="notif-message"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('notif.kind.ADMIN_MESSAGE')}
          >
            <div className="notif-message-head">
              <h4>{t('notif.kind.ADMIN_MESSAGE')}</h4>
              <button
                type="button"
                className="notif-message-close"
                onClick={() => setMessageItem(null)}
                aria-label={t('activity.close')}
              >
                ✕
              </button>
            </div>
            <time className="notif-message-time" dateTime={messageItem.createdAt}>
              {timeFor(messageItem.createdAt)}
            </time>
            <div
              className="notif-message-body rte-content"
              dangerouslySetInnerHTML={{ __html: messageItem.message ?? '' }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
