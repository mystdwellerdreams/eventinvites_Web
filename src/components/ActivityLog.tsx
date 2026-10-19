import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { activityAPI, apiErrorMessage, resolveAssetUrl } from '../utils/api'
import { useI18n } from '../i18n'
import { useMediaQuery } from '../hooks/useMediaQuery'
import type {
  ActivityCategory,
  ActivityLogEntry,
  ActivitySettings,
} from '../types'
import './ActivityLog.css'

/** One filter chip can cover several categories, as events and comments do. */
const FILTERS: { key: string; labelKey: string; categories: ActivityCategory[] }[] = [
  { key: 'ALL', labelKey: 'activity.filterAll', categories: [] },
  { key: 'REGISTRATION', labelKey: 'activity.filterRegistrations', categories: ['REGISTRATION'] },
  { key: 'GUEST_APPROVAL', labelKey: 'activity.filterConfirmations', categories: ['GUEST_APPROVAL'] },
  { key: 'PASSWORD_RESET', labelKey: 'activity.filterResets', categories: ['PASSWORD_RESET'] },
  { key: 'EVENT', labelKey: 'activity.filterEvents', categories: ['EVENT_CREATED', 'EVENT_UPCOMING'] },
  { key: 'COMMENT', labelKey: 'activity.filterComments', categories: ['COMMENT', 'COMMENT_REPLY'] },
  { key: 'BANNER', labelKey: 'activity.filterBanners', categories: ['BANNER'] },
  { key: 'FEEDBACK', labelKey: 'activity.filterFeedback', categories: ['FEEDBACK'] },
]

const CATEGORY_ICONS: Record<ActivityCategory, string> = {
  REGISTRATION: '👤',
  GUEST_APPROVAL: '✅',
  PASSWORD_RESET: '🔑',
  EVENT_CREATED: '📅',
  EVENT_UPCOMING: '⏰',
  COMMENT: '💬',
  COMMENT_REPLY: '↩️',
  BANNER: '🖼️',
  FEEDBACK: '✉️',
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * The administrator's activity log: registrations, guest confirmations,
 * password reset requests, event creation and upcoming events, comments,
 * banner changes and feedback, newest first by default.
 */
export default function ActivityLog({
  onReplyToFeedback,
  onOpenFeedbackChat,
}: {
  /** Lets the administrator answer a feedback message to its sender. */
  onReplyToFeedback?: (userId: string, name: string) => void
  /** Opens the sender's feedback conversation in the Messages section. */
  onOpenFeedbackChat?: (userId: string) => void
} = {}) {
  const { t, locale } = useI18n()
  const router = useRouter()
  // In portrait the feedback detail opens between the entries themselves.
  const isPortrait = useMediaQuery('(orientation: portrait)')

  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [settings, setSettings] = useState<ActivitySettings>({ logComments: false })
  const [filter, setFilter] = useState('ALL')
  const [sort, setSort] = useState<'desc' | 'asc'>('desc')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // Feedback detail: a modal in landscape, an inline panel in portrait.
  const [openId, setOpenId] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  // The entry armed for removal by its corner X.
  const [armedId, setArmedId] = useState<string | null>(null)
  // The confirmation dialog in front of a full clear.
  const [clearOpen, setClearOpen] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    activityAPI
      .list({ sort: 'desc' })
      .then((r) => {
        if (!active) return
        setEntries(r.data.entries)
        setSettings(r.data.settings)
        setError('')
      })
      .catch((err) => {
        if (active) setError(apiErrorMessage(err, t('activity.loadFailed')))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [t])

  const activeFilter = FILTERS.find((f) => f.key === filter) ?? FILTERS[0]

  const visible = useMemo(() => {
    const rows = activeFilter.categories.length
      ? entries.filter((e) => activeFilter.categories.includes(e.category))
      : entries
    const sorted = [...rows].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
    return sort === 'desc' ? sorted.reverse() : sorted
  }, [entries, activeFilter, sort])

  const toggleCommentLogging = async (logComments: boolean) => {
    setSavingSettings(true)
    try {
      await activityAPI.updateSettings({ logComments })
      setSettings({ logComments })
    } catch (err) {
      window.alert(apiErrorMessage(err, t('activity.settingsFailed')))
    } finally {
      setSavingSettings(false)
    }
  }

  const selected = visible.find((e) => e.id === openId) ?? null

  const openFeedback = (entry: ActivityLogEntry) => {
    setOpenId((current) => (current === entry.id ? null : entry.id))
  }

  /**
   * The corner X works in two steps, the way the participant menu's remove
   * button does: the first click arms the entry, the second removes it.
   * Arming another entry, navigating, or changing the filter disarms.
   */
  const handleRemove = (entry: ActivityLogEntry) => {
    if (armedId === entry.id) {
      void removeEntry(entry)
      return
    }
    setArmedId(entry.id)
  }

  const removeEntry = async (entry: ActivityLogEntry) => {
    try {
      await activityAPI.remove(entry.id)
      setEntries((prev) => prev.filter((item) => item.id !== entry.id))
      setArmedId(null)
      // A removed entry can no longer hold the open feedback detail.
      setOpenId((current) => (current === entry.id ? null : current))
    } catch (err) {
      window.alert(apiErrorMessage(err, t('activity.removeFailed')))
    }
  }

  const clearLog = async () => {
    try {
      await activityAPI.clear()
      setEntries([])
      setArmedId(null)
      setOpenId(null)
      setClearOpen(false)
    } catch (err) {
      window.alert(apiErrorMessage(err, t('activity.clearFailed')))
    }
  }

  /**
   * Where an entry leads when clicked: feedback opens in place, everything
   * else goes to the screen it belongs to. Entries with nothing to show —
   * registrations, reset requests, or a comment whose event is unknown —
   * are left quiet.
   */
  const actionFor = (
    entry: ActivityLogEntry
  ): { label: string; run: () => void } | null => {
    switch (entry.category) {
      case 'FEEDBACK':
        // Handled by the expand/collapse click instead.
        return null
      case 'GUEST_APPROVAL':
        return {
          label: t('activity.openRequests'),
          run: () => router.push('/admin?tab=users&view=requests'),
        }
      case 'COMMENT':
      case 'COMMENT_REPLY': {
        const eventId = entry.meta?.eventId
        if (!eventId || !entry.targetId) return null
        return {
          label: t('activity.openComment'),
          run: () => router.push(`/events/${eventId}#comment-${entry.targetId}`),
        }
      }
      case 'BANNER':
        return {
          label: t('activity.openBanners'),
          run: () => router.push('/admin?tab=banners'),
        }
      case 'EVENT_CREATED':
      case 'EVENT_UPCOMING':
        return entry.targetId
          ? {
              label: t('activity.openEvent'),
              run: () => router.push(`/events/${entry.targetId}`),
            }
          : null
      default:
        return null
    }
  }

  const feedbackDetail = (entry: ActivityLogEntry) => (
    <div className="al-feedback-detail">
      <div className="al-feedback-head">
        <span className="al-feedback-sender">{entry.actorName ?? '—'}</span>
        <time dateTime={entry.createdAt} title={new Date(entry.createdAt).toLocaleString(locale)}>
          {new Date(entry.createdAt).toLocaleString(locale)}
        </time>
      </div>
      {entry.message && (
        <div
          className="al-feedback-message rte-content"
          dangerouslySetInnerHTML={{ __html: entry.message }}
        />
      )}
      {entry.meta?.attachment && (
        <a
          className="al-feedback-attachment"
          href={resolveAssetUrl(entry.meta.attachment.url)}
          download={entry.meta.attachment.name}
        >
          <span aria-hidden="true">📎</span>
          {entry.meta.attachment.name}
          <span className="al-feedback-size">
            {formatBytes(entry.meta.attachment.size)}
          </span>
        </a>
      )}
      {/* An answer reaches the sender as a notification. */}
      {onReplyToFeedback && entry.actorId && (
        <button
          type="button"
          className="al-feedback-reply"
          onClick={(e) => {
            e.stopPropagation()
            onReplyToFeedback(entry.actorId as string, entry.actorName ?? '')
          }}
        >
          {t('activity.replyToFeedback')}
        </button>
      )}
      {/* Or as a conversation in the Messages section. */}
      {onOpenFeedbackChat && entry.actorId && (
        <button
          type="button"
          className="al-feedback-reply"
          onClick={(e) => {
            e.stopPropagation()
            onOpenFeedbackChat(entry.actorId as string)
          }}
        >
          {t('activity.openFeedbackChat')}
        </button>
      )}
    </div>
  )

  return (
    <section className="al-section">
      <header className="al-header">
        <div>
          <h3>{t('activity.title')}</h3>
          <p className="admin-hint">{t('activity.hint')}</p>
        </div>
        <div className="al-controls">
          <label className="al-sort">
            <span>{t('activity.sort')}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value === 'asc' ? 'asc' : 'desc')}
            >
              <option value="desc">{t('activity.sortNewest')}</option>
              <option value="asc">{t('activity.sortOldest')}</option>
            </select>
          </label>
          <button
            type="button"
            className="al-clear"
            onClick={() => setClearOpen(true)}
            disabled={entries.length === 0}
          >
            {t('activity.clear')}
          </button>
        </div>
      </header>

      <div className="al-filters" role="group" aria-label={t('activity.filterLabel')}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`al-filter ${filter === f.key ? 'is-active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      <label className="al-comment-toggle">
        <input
          type="checkbox"
          checked={settings.logComments}
          disabled={savingSettings}
          onChange={(e) => toggleCommentLogging(e.target.checked)}
        />
        <span>{t('activity.logComments')}</span>
      </label>
      <p className="al-comment-toggle-hint">{t('activity.logCommentsHint')}</p>

      {loading && (
        <div className="al-loading">
          <div className="spinner" />
          <p>{t('activity.loading')}</p>
        </div>
      )}

      {!loading && error && <p className="admin-muted">{error}</p>}

      {!loading && !error && visible.length === 0 && (
        <p className="admin-muted">{t('activity.empty')}</p>
      )}

      {!loading && !error && visible.length > 0 && (
        <ul className="al-list">
          {visible.map((entry) => {
            const isFeedback = entry.category === 'FEEDBACK'
            const expanded = openId === entry.id
            const action = actionFor(entry)
            const armed = armedId === entry.id
            const classes = ['al-entry']
            if (isFeedback) classes.push('is-feedback')
            if (expanded) classes.push('is-open')
            if (action) classes.push('is-actionable')
            if (armed) classes.push('is-armed')
            // Clicking the row navigates or expands; either way a half-armed
            // entry goes back to rest.
            const runRow = () => {
              setArmedId(null)
              if (isFeedback) openFeedback(entry)
              else action?.run()
            }
            return (
              <li key={entry.id}>
                <div
                  className={classes.join(' ')}
                  title={armed ? t('activity.confirmRemove') : action?.label}
                  onClick={isFeedback || action ? runRow : undefined}
                  role={isFeedback || action ? 'button' : undefined}
                  tabIndex={isFeedback || action ? 0 : undefined}
                  onKeyDown={
                    isFeedback || action
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            runRow()
                          }
                        }
                      : undefined
                  }
                >
                  <span className="al-icon" aria-hidden="true">
                    {CATEGORY_ICONS[entry.category]}
                  </span>
                  {/* The corner X: first click arms, second click removes. */}
                  <button
                    type="button"
                    className={`al-remove ${armed ? 'is-armed' : ''}`}
                    aria-label={armed ? t('activity.confirmRemove') : t('activity.removeEntry')}
                    title={armed ? t('activity.confirmRemove') : t('activity.removeEntry')}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(entry)
                    }}
                  >
                    ✕
                  </button>
                  <div className="al-body">
                    <div className="al-line">
                      <span className="al-category">{t(`activity.category.${entry.category}`)}</span>
                      {entry.targetName && (
                        <span className="al-target">{entry.targetName}</span>
                      )}
                      <span className="al-actor">
                        {entry.actorName ?? t('activity.system')}
                      </span>
                    </div>
                    {entry.detail && entry.category !== 'BANNER' && (
                      <p className="al-detail">{entry.detail}</p>
                    )}
                    {entry.category === 'BANNER' && entry.detail && (
                      <p className="al-detail">{t(`activity.bannerAction.${entry.detail}`)}</p>
                    )}
                    <time
                      className="al-time"
                      dateTime={entry.createdAt}
                      title={new Date(entry.createdAt).toLocaleString(locale)}
                    >
                      {new Date(entry.createdAt).toLocaleString(locale)}
                    </time>
                  </div>
                  {isFeedback && (
                    <span className="al-chevron" aria-hidden="true">
                      {expanded ? '▴' : '▾'}
                    </span>
                  )}
                  {action && !isFeedback && (
                    <span className="al-go" aria-hidden="true">
                      ›
                    </span>
                  )}
                </div>
                {/* Portrait keeps the detail between this entry and the next;
                    landscape shows it as a modal instead. */}
                {isFeedback && expanded && isPortrait && feedbackDetail(entry)}
              </li>
            )
          })}
        </ul>
      )}

      {/* Landscape: the feedback message opens in its own window. */}
      {selected && selected.category === 'FEEDBACK' && !isPortrait && (
        <div className="al-modal-overlay" onClick={() => setOpenId(null)}>
          <div
            className="al-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('activity.filterFeedback')}
          >
            <div className="al-modal-head">
              <h4>{t('activity.feedbackFrom', { name: selected.actorName ?? '—' })}</h4>
              <button
                type="button"
                className="al-modal-close"
                onClick={() => setOpenId(null)}
                aria-label={t('activity.close')}
              >
                ✕
              </button>
            </div>
            {feedbackDetail(selected)}
          </div>
        </div>
      )}

      {/* Clearing the log is irreversible, so it asks first. */}
      {clearOpen && (
        <div className="al-modal-overlay" onClick={() => setClearOpen(false)}>
          <div
            className="al-modal al-confirm"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={t('activity.clear')}
          >
            <div className="al-modal-head">
              <h4>{t('activity.clearTitle')}</h4>
              <button
                type="button"
                className="al-modal-close"
                onClick={() => setClearOpen(false)}
                aria-label={t('activity.cancel')}
              >
                ✕
              </button>
            </div>
            <p className="al-confirm-text">{t('activity.clearWarning')}</p>
            <div className="al-confirm-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setClearOpen(false)}
              >
                {t('activity.cancel')}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => void clearLog()}
              >
                {t('activity.clearConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
