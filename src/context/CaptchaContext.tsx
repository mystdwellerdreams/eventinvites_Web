'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { onConnectionTrouble } from '../hooks/useConnectivity'
import { useI18n } from '../i18n'
import { API_BASE, env } from '../utils/env'
import '../components/Captcha.css'

/** The actions a challenge can be presented for. */
export type CaptchaAction =
  | 'login'
  | 'register'
  | 'event-create'
  | 'event-delete'
  | 'feedback'
  /** Reserved for the future session check, when suspicious activity is
   *  detected and the visitor must clear a challenge to carry on. */
  | 'session'

/** Turnstile's own browser global, once its script has loaded. */
interface TurnstileApi {
  render(
    container: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback'?: () => void
      'error-callback'?: () => void
      theme?: 'light' | 'dark'
      size?: 'normal' | 'flexible'
    }
  ): string
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

/** How long the script may take before the fallback takes over. */
const SCRIPT_TIMEOUT_MS = 8000

/**
 * How long the widget may take to answer before the app's own challenge
 * takes over.
 *
 * A widget that cannot be used — its hostname is not allowed, the script is
 * half blocked, the connection to the provider is gone — can sit there
 * without answering and without saying why. The form would then wait for a
 * token that is never coming, and the visitor could not sign in at all.
 */
const WIDGET_TIMEOUT_MS = 20000

const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

/** What a consumer of the provider needs to know. */
export interface CaptchaContextValue {
  /** Which verification is in force for new challenges. */
  mode: 'loading' | 'cloudflare' | 'fallback'
  /** A verified token for an action, when one has been produced. */
  tokenFor: (action: CaptchaAction) => string | null
  /** Records a verified token for an action. */
  solved: (action: CaptchaAction, token: string) => void
  /**
   * Reports that the Cloudflare widget itself failed, so the app's own
   * challenge takes over.
   *
   * The script can load and the widget still fail to render — a WebView is
   * the usual reason — and an empty token is not a token, so without this the
   * visitor would be left with a challenge that can never be answered.
   */
  widgetFailed: () => void
  /** Forgets an action's token, so the next attempt asks again. */
  clear: (action: CaptchaAction) => void
  /** The overlay currently blocking the screen, if any. */
  challenge: CaptchaChallenge | null
  /**
   * Puts a challenge in front of everything and calls `onVerified` with
   * the token once it is cleared. This is the mechanism a future
   * suspicious-activity detector will call to hold the session until the
   * visitor proves they are a person.
   */
  requireChallenge: (action: CaptchaAction, onVerified: (token: string) => void) => void
  /** Dismisses the overlay without a token. */
  dismissChallenge: () => void
}

/** The overlay's state: what it is for and what happens when it is cleared. */
export interface CaptchaChallenge {
  action: CaptchaAction
  onVerified: (token: string) => void
}

const CaptchaContext = createContext<CaptchaContextValue | null>(null)

/**
 * The Cloudflare widget, which verifies itself without the visitor doing
 * anything when it can. It is rendered into its own element and reports
 * back through the callback; a widget that errors or expires simply stops
 * producing tokens, which is the provider's cue to fall back.
 */
function TurnstileWidget({
  siteKey,
  onToken,
  onFailed,
  theme,
}: {
  siteKey: string
  onToken: (token: string) => void
  onFailed: () => void
  theme: 'light' | 'dark'
}) {
  const holder = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  // The callback is kept in a ref so re-rendering never re-renders the
  // widget, which would restart the challenge.
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const onFailedRef = useRef(onFailed)
  onFailedRef.current = onFailed

  useEffect(() => {
    if (!holder.current || !window.turnstile) return
    let answered = false
    const timer = window.setTimeout(() => {
      // The widget was rendered but never answered. Nobody is going to get a
      // token out of it, so the app's own challenge takes over rather than
      // leaving the form waiting for one.
      if (!answered) onFailedRef.current()
    }, WIDGET_TIMEOUT_MS)
    widgetId.current = window.turnstile.render(holder.current, {
      sitekey: siteKey,
      theme,
      size: 'flexible',
      callback: (token) => {
        answered = true
        onTokenRef.current(token)
      },
      'expired-callback': () => {
        answered = true
        onTokenRef.current('')
      },
      'error-callback': () => {
        answered = true
        onTokenRef.current('')
        // The widget could not render. An empty token is not a token, so the
        // app's own challenge has to take over.
        onFailedRef.current()
      },
    })
    return () => {
      window.clearTimeout(timer)
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current)
        widgetId.current = null
      }
    }
  }, [siteKey, theme])

  return <div className="captcha-slot" ref={holder} />
}

/**
 * The app's own challenge, used whenever the Cloudflare widget is not
 * available: the script is blocked, the connection to it is gone, or no
 * site key is configured for this environment. The question comes from the
 * server and the answer is checked there, so it cannot be bypassed.
 */
function FallbackWidget({
  action,
  onToken,
}: {
  action: CaptchaAction
  onToken: (token: string) => void
}) {
  const { t } = useI18n()
  const [challenge, setChallenge] = useState<{ id: string; question: string } | null>(null)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void fetch(`${API_BASE}/captcha/fallback`, { method: 'POST' })
      .then((r) => r.json())
      .then((body: { id: string; question: string }) => {
        if (alive) setChallenge(body)
      })
      .catch(() => {
        if (alive) setError(t('captcha.fallbackUnavailable'))
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A form of its own would nest inside the forms it is placed in — the
  // sign-in, feedback and event forms — which is invalid HTML. So this is
  // a plain group whose button answers rather than submits.
  const submit = async () => {
    if (!challenge || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/captcha/fallback/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: challenge.id, answer, action }),
      })
      const body = (await response.json()) as { token?: string; error?: string }
      if (!response.ok || !body.token) {
        setError(body.error ?? t('captcha.wrongAnswer'))
        // A fresh question, so the same one is not retried forever.
        setAnswer('')
        const next = await fetch(`${API_BASE}/captcha/fallback`, { method: 'POST' }).then((r) => r.json())
        setChallenge(next as { id: string; question: string })
        return
      }
      onToken(body.token)
    } catch {
      setError(t('captcha.unreachable'))
    } finally {
      setBusy(false)
    }
  }

  // Enter answers, the way a form would: the field is not itself inside a
  // form, so the key is handled here.
  const onAnswerKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }

  return (
    <div className="captcha-fallback" role="group" aria-label={t('captcha.title')}>
      {challenge ? (
        <>
          <p className="captcha-fallback-question">{challenge.question}</p>
          <input
            className="captcha-fallback-input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={onAnswerKeyDown}
            inputMode="numeric"
            autoComplete="off"
            aria-label={t('captcha.answer')}
            disabled={busy}
          />
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={() => void submit()}
            disabled={busy || !answer.trim()}
          >
            {busy ? t('captcha.checking') : t('captcha.check')}
          </button>
        </>
      ) : (
        <p className="captcha-fallback-question">{error || t('captcha.fallbackLoading')}</p>
      )}
      {error && challenge && <p className="captcha-fallback-error">{error}</p>}
    </div>
  )
}

/**
 * Holds the answer to "which challenge is in force" so every protected
 * action asks the same way.
 *
 * The Cloudflare widget is the default: it verifies itself and hands over a
 * token. When its script cannot load — blocked, offline, slow — the
 * provider falls back to the app's own challenge, and it hears about
 * connection trouble from the connection controller rather than waiting to
 * discover it itself.
 */
export function CaptchaProvider({ children }: { children: ReactNode }) {
  const siteKey = env('TURNSTILE_SITE_KEY')
  const [scriptState, setScriptState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const [tokens, setTokens] = useState<Partial<Record<CaptchaAction, string>>>({})
  const [challenge, setChallenge] = useState<CaptchaChallenge | null>(null)

  // Loading the Cloudflare script once for the whole app.
  useEffect(() => {
    if (!siteKey) {
      // No key for this environment: the fallback is the only option.
      setScriptState('failed')
      return
    }
    if (window.turnstile) {
      setScriptState('ready')
      return
    }
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile]')
    if (existing) {
      setScriptState('loading')
      const onLoad = () => setScriptState('ready')
      const onError = () => setScriptState('failed')
      existing.addEventListener('load', onLoad)
      existing.addEventListener('error', onError)
      return () => {
        existing.removeEventListener('load', onLoad)
        existing.removeEventListener('error', onError)
      }
    }

    setScriptState('loading')
    const script = document.createElement('script')
    script.src = TURNSTILE_SCRIPT
    script.async = true
    script.defer = true
    script.setAttribute('data-turnstile', '')
    const timeout = window.setTimeout(() => {
      // Nothing arrived in time, which is the same as not arriving.
      setScriptState((s) => (s === 'ready' ? s : 'failed'))
    }, SCRIPT_TIMEOUT_MS)
    script.addEventListener('load', () => {
      window.clearTimeout(timeout)
      setScriptState('ready')
    })
    script.addEventListener('error', () => {
      window.clearTimeout(timeout)
      setScriptState('failed')
    })
    document.head.appendChild(script)
    return () => window.clearTimeout(timeout)
  }, [siteKey])

  // The connection controller watches the network. Trouble reported there
  // means the widget is unlikely to arrive either, so the fallback takes
  // over without waiting for the script's own error.
  useEffect(() => onConnectionTrouble(() => setScriptState((s) => (s === 'ready' ? s : 'failed'))), [])

  const mode = scriptState === 'ready' ? 'cloudflare' : scriptState === 'loading' ? 'loading' : 'fallback'

  const solved = useCallback((action: CaptchaAction, token: string) => {
    if (!token) return
    setTokens((current) => ({ ...current, [action]: token }))
  }, [])

  // The widget failed rather than the script: the same answer, which is the
  // app's own challenge.
  const widgetFailed = useCallback(() => setScriptState('failed'), [])

  const clear = useCallback((action: CaptchaAction) => {
    setTokens((current) => {
      if (!(action in current)) return current
      const next = { ...current }
      delete next[action]
      return next
    })
  }, [])

  const tokenFor = useCallback((action: CaptchaAction) => tokens[action] ?? null, [tokens])

  const requireChallenge = useCallback(
    (action: CaptchaAction, onVerified: (token: string) => void) => {
      setChallenge({ action, onVerified })
    },
    []
  )

  const dismissChallenge = useCallback(() => setChallenge(null), [])

  const value = useMemo<CaptchaContextValue>(
    () => ({
      mode,
      tokenFor,
      solved,
      widgetFailed,
      clear,
      challenge,
      requireChallenge,
      dismissChallenge,
    }),
    [mode, tokenFor, solved, widgetFailed, clear, challenge, requireChallenge, dismissChallenge]
  )

  return (
    <CaptchaContext.Provider value={value}>
      {children}
      {/* The overlay variant: a challenge in front of the whole screen.
          The future suspicious-activity check calls requireChallenge and
          lands here without any further wiring. */}
      {challenge && (
        <CaptchaOverlay
          action={challenge.action}
          onVerified={(token) => {
            const pending = challenge.onVerified
            setChallenge(null)
            pending(token)
          }}
          onDismiss={dismissChallenge}
        />
      )}
    </CaptchaContext.Provider>
  )
}

/** The overlay, also used directly by the pages that challenge before
 *  creating or deleting an event. */
function CaptchaOverlay({
  action,
  onVerified,
  onDismiss,
}: {
  action: CaptchaAction
  onVerified: (token: string) => void
  onDismiss: () => void
}) {
  const { t } = useI18n()
  const { mode, solved } = useCaptcha()
  return (
    <div className="captcha-overlay" role="dialog" aria-modal="true" aria-label={t('captcha.title')}>
      <div className="captcha-card">
        <h2>{t('captcha.title')}</h2>
        <p>{t('captcha.prompt')}</p>
        {mode === 'cloudflare' ? (
          <TurnstileSlot action={action} onToken={solved} />
        ) : mode === 'loading' ? (
          <p className="captcha-note">{t('captcha.loading')}</p>
        ) : (
          <FallbackWidget action={action} onToken={onVerified} />
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
          {t('captcha.cancel')}
        </button>
      </div>
    </div>
  )
}

/** The inline slot: the Cloudflare widget when it is in force, the app's
 *  own challenge otherwise. */
export function CaptchaSlot({ action }: { action: CaptchaAction }) {
  const { t } = useI18n()
  const { mode, solved } = useCaptcha()
  if (mode === 'loading') return <p className="captcha-note">{t('captcha.loading')}</p>
  if (mode === 'cloudflare') return <TurnstileSlot action={action} onToken={solved} />
  return <FallbackWidget action={action} onToken={(token) => solved(action, token)} />
}

/** The Cloudflare widget, reading the site key from the environment. */
function TurnstileSlot({
  action,
  onToken,
}: {
  action: CaptchaAction
  onToken: (action: CaptchaAction, token: string) => void
}) {
  const { t } = useI18n()
  const { mode, solved, widgetFailed } = useCaptcha()
  const siteKey = env('TURNSTILE_SITE_KEY')
  const dark =
    typeof document !== 'undefined' &&
    document.documentElement.getAttribute('data-theme') === 'dark'
  return (
    <TurnstileWidget
      siteKey={siteKey}
      theme={dark ? 'dark' : 'light'}
      onToken={(token) => onToken(action, token)}
      onFailed={widgetFailed}
    />
  )
}

export function useCaptcha(): CaptchaContextValue {
  const value = useContext(CaptchaContext)
  if (!value) {
    throw new Error('useCaptcha must be used within a CaptchaProvider')
  }
  return value
}
