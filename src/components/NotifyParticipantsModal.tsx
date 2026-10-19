import { useEffect, useState } from 'react'
import { eventsAPI, apiErrorMessage } from '../utils/api'
import { useI18n } from '../i18n'

/**
 * An organizer's update for everyone registered for an event. It is
 * delivered as a broadcast notification, so it reaches each participant
 * wherever they are and disappears with the event itself.
 */
export default function NotifyParticipantsModal({
  eventId,
  onClose,
}: {
  eventId: string
  onClose: () => void
}) {
  const { t } = useI18n()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const heading = title.trim()
    const body = message.trim()
    if (!heading || !body) return
    setSending(true)
    setError('')
    try {
      await eventsAPI.notifyParticipants(eventId, { title: heading, message: body })
      setSent(true)
      window.setTimeout(onClose, 1400)
    } catch (err) {
      setError(apiErrorMessage(err, t('notifications.updateFailed')))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fb-overlay" onClick={onClose}>
      <div
        className="fb-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t('notifications.updateTitle')}
      >
        <button
          type="button"
          className="fb-close"
          onClick={onClose}
          aria-label={t('feedback.close')}
        >
          ✕
        </button>

        <div className="fb-header">
          <h2>{t('notifications.updateTitle')}</h2>
          <p>{t('notifications.updateHint')}</p>
        </div>

        {sent ? (
          <p className="fb-sent">{t('notifications.updateSent')}</p>
        ) : (
          <form className="fb-body" onSubmit={submit}>
            <input
              value={title}
              maxLength={200}
              placeholder={t('notifications.updatePlaceholder')}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="ec-textarea"
              value={message}
              maxLength={5000}
              rows={6}
              placeholder={t('notifications.updateBody')}
              onChange={(e) => setMessage(e.target.value)}
            />
            {error && <p className="fb-error">{error}</p>}
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={sending || !title.trim() || !message.trim()}
            >
              {sending ? t('feedback.sending') : t('notifications.updateSend')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
