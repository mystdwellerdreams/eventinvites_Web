import { useEffect, useState } from 'react'
import { useAuthModal } from '../context/AuthModalContext'
import { authAPI, apiErrorMessage } from '../utils/api'
import { useI18n } from '../i18n'
import './ResetPasswordPage.css'

type Phase =
  | { kind: 'checking' }
  | { kind: 'invalid'; message: string }
  | { kind: 'ready'; name: string }
  | { kind: 'done' }

export default function ResetPasswordPage({ token }: { token: string }) {
  const { t } = useI18n()
  const { open } = useAuthModal()

  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // The link is checked as soon as the page loads, so an
  // expired or already-used link never shows the form.
  useEffect(() => {
    if (!token) {
      setPhase({ kind: 'invalid', message: t('reset.noToken') })
      return
    }
    let active = true
    authAPI
      .validatePasswordReset(token)
      .then((r) => {
        if (active) {
          setPhase({ kind: 'ready', name: r.data.user.name })
        }
      })
      .catch((err) => {
        if (active) {
          setPhase({
            kind: 'invalid',
            message: apiErrorMessage(err, t('reset.invalid')),
          })
        }
      })
    return () => {
      active = false
    }
  }, [token, t])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError(t('reset.mismatch'))
      return
    }
    setSaving(true)
    try {
      await authAPI.resetPassword(token, password)
      setPassword('')
      setConfirm('')
      setPhase({ kind: 'done' })
    } catch (err) {
      setError(apiErrorMessage(err, t('reset.failed')))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="reset-page">
      <div className="reset-card">
        <h1 className="reset-title">{t('reset.title')}</h1>

        {phase.kind === 'checking' && (
          <p className="reset-muted">{t('reset.checking')}</p>
        )}

        {phase.kind === 'invalid' && (
          <div className="reset-body">
            <p className="reset-error">{phase.message}</p>
            <p className="reset-muted">{t('reset.invalidHint')}</p>
          </div>
        )}

        {phase.kind === 'ready' && (
          <form onSubmit={handleSubmit} className="reset-form">
            <p className="reset-muted">
              {t('reset.forAccount', { name: phase.name })}
            </p>
            <div className="form-group">
              <label htmlFor="reset-password">{t('reset.newPassword')}</label>
              <input
                type="password"
                id="reset-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                maxLength={200}
              />
            </div>
            <div className="form-group">
              <label htmlFor="reset-confirm">{t('reset.confirmPassword')}</label>
              <input
                type="password"
                id="reset-confirm"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                maxLength={200}
              />
            </div>
            {error && <div className="form-error">{error}</div>}
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={saving}
            >
              {saving ? t('auth.pleaseWait') : t('reset.submit')}
            </button>
          </form>
        )}

        {phase.kind === 'done' && (
          <div className="reset-body">
            <p className="reset-success">{t('reset.success')}</p>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => open('login')}
            >
              {t('reset.signIn')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
