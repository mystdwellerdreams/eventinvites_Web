import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAuthModal } from '../context/AuthModalContext'
import { authAPI, apiErrorMessage } from '../utils/api'
import { useI18n } from '../i18n'
import { CaptchaSlot, useCaptcha } from '../context/CaptchaContext'
import './AuthModal.css'

const EMPTY_FORM = { identifier: '', name: '', phone: '', email: '', password: '' }

export default function AuthModal() {
  const { isOpen, mode, close, toggleMode, setMode } = useAuthModal()
  const { t } = useI18n()
  const { tokenFor, solved, clear } = useCaptcha()
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, register } = useAuth()

  const isLogin = mode === 'login'
  const isRecover = mode === 'recover'
  // Recovering a password sends no challenge: it reveals nothing and
  // cannot be used to get into an account.
  const action = isLogin ? 'login' : 'register'
  const captchaToken = isRecover ? null : tokenFor(action)

  // A token is single-use, so anything left over from an earlier attempt
  // is dropped as soon as the form is shown again.
  useEffect(() => {
    if (isOpen) {
      clear(action)
      setError('')
      setNotice('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, mode, action])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    if (isOpen) {
      document.addEventListener('keydown', onKeyDown)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [isOpen, close])

  const update = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormData((f) => ({ ...f, [key]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)
    try {
      if (isRecover) {
        const message = await authAPI
          .requestPasswordReset(formData.phone.trim())
          .then((r) => r.data.message as string)
        setNotice(message)
        // The request is in the administrators' hands; the form
        // stays open so the visitor sees the confirmation.
        setLoading(false)
        return
      }
      if (isLogin) {
        await login(formData.identifier.trim(), formData.password, captchaToken)
      } else {
        const message = await register(
          {
            name: formData.name.trim(),
            phone: formData.phone.trim(),
            email: formData.email.trim() || undefined,
            password: formData.password || undefined,
          },
          captchaToken
        )
        if (message) setNotice(message)
      }
      close()
      setFormData(EMPTY_FORM)
    } catch (err) {
      // A rejected challenge is a fresh one: the token is spent either way.
      clear(action)
      setError(apiErrorMessage(err, t('auth.failed')))
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = () => {
    setError('')
    setNotice('')
    toggleMode()
  }

  if (!isOpen) return null

  return (
    <div className="auth-overlay open" onClick={close}>
      <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
        <button className="auth-close" onClick={close} aria-label={t('auth.close')}>
          &times;
        </button>
        <div className="auth-header">
          <h2>
            {isRecover
              ? t('auth.recoverTitle')
              : isLogin
                ? t('auth.signInTitle')
                : t('auth.registerTitle')}
          </h2>
          <p>
            {isRecover
              ? t('auth.recoverSubtitle')
              : isLogin
                ? t('auth.signInSubtitle')
                : t('auth.registerSubtitle')}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {isRecover ? (
            <div className="form-group">
              <label htmlFor="auth-recover-phone">{t('auth.phone')}</label>
              <input
                type="tel"
                id="auth-recover-phone"
                autoComplete="tel"
                placeholder={t('auth.phonePlaceholder')}
                value={formData.phone}
                onChange={update('phone')}
                required
              />
            </div>
          ) : (
            <>
              {!isLogin && (
                <div className="form-group">
                  <label htmlFor="auth-name">{t('auth.name')}</label>
                  <input
                    type="text"
                    id="auth-name"
                    placeholder={t('auth.namePlaceholder')}
                    value={formData.name}
                    onChange={update('name')}
                    required
                    minLength={2}
                    maxLength={50}
                  />
                </div>
              )}

              {/* Signing in goes by identifier; an account is created from
                  its phone number, so no separate id is collected. */}
              {isLogin && (
                <div className="form-group">
                  <label htmlFor="auth-identifier">{t('auth.identifier')}</label>
                  <input
                    type="text"
                    id="auth-identifier"
                    autoComplete="username"
                    placeholder={t('auth.identifierPlaceholder')}
                    value={formData.identifier}
                    onChange={update('identifier')}
                    required
                  />
                </div>
              )}

              {!isLogin && (
                <div className="form-group">
                  <label htmlFor="auth-phone">{t('auth.phone')}</label>
                  <input
                    type="tel"
                    id="auth-phone"
                    autoComplete="tel"
                    placeholder={t('auth.phonePlaceholder')}
                    value={formData.phone}
                    onChange={update('phone')}
                    required
                  />
                </div>
              )}

              <div className="form-group">
                <label htmlFor="auth-password">
                  {t('auth.password')}{' '}
                  {!isLogin && (
                    <span className="auth-optional">{t('auth.passwordOptional')}</span>
                  )}
                </label>
                <input
                  type="password"
                  id="auth-password"
                  autoComplete={isLogin ? 'current-password' : 'new-password'}
                  placeholder="••••••••"
                  value={formData.password}
                  onChange={update('password')}
                  required={isLogin}
                  minLength={isLogin ? 1 : undefined}
                />
              </div>
            </>
          )}

          {error && <div className="form-error">{error}</div>}
          {notice && <div className="form-notice">{notice}</div>}

          {/* The check sits at the bottom of the form, just above the
              submit button; recovering a password asks for nothing. */}
          {!isRecover && <CaptchaSlot action={action} />}

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading || (!isRecover && !captchaToken)}
          >
            {loading
              ? t('auth.pleaseWait')
              : isRecover
                ? t('auth.recoverSubmit')
                : isLogin
                  ? t('auth.signIn')
                  : t('auth.createAccount')}
          </button>
        </form>

        <div className="auth-footer">
          {isRecover ? (
            <p>
              <button onClick={() => setMode('login')} className="link-btn" type="button">
                {t('auth.backToSignIn')}
              </button>
            </p>
          ) : (
            <>
              <p>
                {isLogin ? t('auth.noAccount') : t('auth.hasAccount')}
                <button onClick={handleToggle} className="link-btn" type="button">
                  {isLogin ? t('auth.signUp') : t('auth.signInLink')}
                </button>
              </p>
              {isLogin && (
                <p>
                  <button onClick={() => setMode('recover')} className="link-btn" type="button">
                    {t('auth.forgotPassword')}
                  </button>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
