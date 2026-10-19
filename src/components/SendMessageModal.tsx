import { useEffect, useState } from 'react'
import { usersAPI, apiErrorMessage } from '../utils/api'
import { useI18n } from '../i18n'

/**
 * A short message from an administrator to one user. It is delivered as an
 * individual notification and opened from the bell, so the body is plain
 * prose rather than a rich-text document.
 */
export default function SendMessageModal({
  userId,
  userName,
  onClose,
}: {
  userId: string
  userName: string
  onClose: () => void
}) {
  const { t } = useI18n()
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
    const text = message.trim()
    if (!text) return
    setSending(true)
    setError('')
    try {
      await usersAPI.sendMessage(userId, text)
      setSent(true)
      window.setTimeout(onClose, 1400)
    } catch (err) {
      setError(apiErrorMessage(err, t('notifications.sendFailed')))
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
        aria-label={t('notifications.sendTitle')}
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
          <h2>{t('notifications.sendTitle')}</h2>
          <p>{t('notifications.sendTo', { name: userName })}</p>
        </div>

        {sent ? (
          <p className="fb-sent">{t('notifications.sent')}</p>
        ) : (
          <form className="fb-body" onSubmit={submit}>
            <textarea
              className="ec-textarea"
              value={message}
              maxLength={5000}
              rows={6}
              placeholder={t('notifications.messagePlaceholder')}
              onChange={(e) => setMessage(e.target.value)}
            />
            {error && <p className="fb-error">{error}</p>}
            <button type="submit" className="btn btn-primary btn-sm" disabled={sending || !message.trim()}>
              {sending ? t('feedback.sending') : t('notifications.send')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
