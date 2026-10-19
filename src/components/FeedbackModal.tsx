import { useEffect, useState } from 'react'
import { feedbackAPI, apiErrorMessage } from '../utils/api'
import { useI18n } from '../i18n'
import RichTextEditor from './RichTextEditor'
import { CaptchaSlot, useCaptcha } from '../context/CaptchaContext'
// The panel is styled from wherever it opens, so its stylesheet travels with
// the component instead of living in the activity log's.
import './FeedbackModal.css'

/** Feedback ceiling; the server rejects anything larger as well. */
const MAX_FILE_BYTES = 5 * 1024 * 1024

/** Strips the editor's markup, leaving what the user actually typed. */
function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === ''
}

/**
 * The feedback form, opened from the header menu. The message is written in
 * the same rich-text editor the event description uses, and one file of at
 * most 5 MB can be attached. Sent messages land in the administrators'
 * activity log, under the feedback filter of the Status tab.
 */
export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const { tokenFor, solved, clear } = useCaptcha()
  const [message, setMessage] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  // The form's own challenge: a token spent on a failed send is replaced.
  const captchaToken = tokenFor('feedback')
  useEffect(() => {
    clear('feedback')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes the form, the same way every other dialog here does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const pickFile = (picked: File | undefined) => {
    if (!picked) return
    if (picked.size > MAX_FILE_BYTES) {
      setError(t('feedback.fileTooLarge'))
      return
    }
    setError('')
    setFile(picked)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isEmptyHtml(message)) {
      setError(t('feedback.messageRequired'))
      return
    }
    setSending(true)
    setError('')
    try {
      await feedbackAPI.submit({ message, file, captchaToken })
      setSent(true)
      window.setTimeout(onClose, 1400)
    } catch (err) {
      clear('feedback')
      setError(apiErrorMessage(err, t('feedback.sendFailed')))
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
        aria-label={t('feedback.title')}
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
          <h2>{t('feedback.title')}</h2>
          <p>{t('feedback.subtitle')}</p>
        </div>

        {sent ? (
          <p className="fb-sent">{t('feedback.sent')}</p>
        ) : (
          <form className="fb-body" onSubmit={submit}>
            <RichTextEditor
              value={message}
              onChange={setMessage}
              placeholder={t('feedback.placeholder')}
              ariaLabel={t('feedback.title')}
            />

            <div className="fb-file">
              <label className="fb-file-button" htmlFor="feedback-file">
                <span aria-hidden="true">📎</span>
                {t('feedback.attach')}
              </label>
              <input
                id="feedback-file"
                className="fb-file-input"
                type="file"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
              {file && (
                <>
                  <span className="fb-file-name">{file.name}</span>
                  <button
                    type="button"
                    className="fb-file-remove"
                    onClick={() => setFile(null)}
                    aria-label={t('feedback.removeFile')}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
            <p className="fb-hint">{t('feedback.fileHint')}</p>

            {/* The check sits above the send button, so the message is
                written before anything is asked for. */}
            <CaptchaSlot action="feedback" />

            {error && <p className="fb-error">{error}</p>}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={sending || !captchaToken}
            >
              {sending ? t('feedback.sending') : t('feedback.send')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
