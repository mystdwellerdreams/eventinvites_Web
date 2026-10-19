import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n'
import { connectivityMessage, useConnectivity } from '../hooks/useConnectivity'
import './ConnectivityIndicator.css'

/**
 * The connection controller's face: a small spinner fixed in the corner,
 * shown only while one of the three connections — the internet, the
 * database or the upload store — is unavailable, and naming what is being
 * done about it.
 *
 * It sits above the page's other corner furniture, so the two pinned
 * controls it would otherwise cover read its height: the event editor's
 * save bar lifts it clear, and the toolbox column moves up to sit above
 * it. Both are plain CSS variables on the document root, so the coupling
 * is a measurement rather than a layout argument.
 */
export default function ConnectivityIndicator() {
  const { t } = useI18n()
  const { status, phase, secondsLeft, visible, restored } = useConnectivity()
  const rootRef = useRef<HTMLDivElement>(null)

  // The problem state while a layer is down, the confirmation for a moment
  // after they all come back, and nothing at any other time. Both states
  // take up the same room, so the toolbox clears either of them.
  const shown = visible || restored

  // The editor's save bar owns the bottom edge of that page, so the
  // indicator lifts itself above it rather than covering the buttons.
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector('.ae-actions')
      const height = bar ? Math.ceil(bar.getBoundingClientRect().height) : 0
      document.documentElement.style.setProperty(
        '--connectivity-offset',
        `${height}px`
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    const bar = document.querySelector('.ae-actions')
    if (bar) observer.observe(bar)
    return () => observer.disconnect()
  }, [])

  // And the toolbox column, so it does not end up underneath. Either state
  // — the problem or the confirmation after it — takes up the same room.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const publish = () => {
      const height = shown ? Math.ceil(el.getBoundingClientRect().height) + 8 : 0
      document.documentElement.style.setProperty('--connectivity-height', `${height}px`)
    }
    publish()
    const observer = new ResizeObserver(publish)
    observer.observe(el)
    return () => observer.disconnect()
  }, [shown])

  const messageKey = connectivityMessage(status)
  const text = t(messageKey)

  return (
    <div
      className={`connectivity ${visible ? 'is-visible' : ''} ${restored && !visible ? 'is-restored' : ''}`}
      ref={rootRef}
      role="status"
      aria-live="polite"
      aria-hidden={!shown}
    >
      {restored && !visible ? (
        <>
          <span className="connectivity-spinner connectivity-spinner--done" aria-hidden="true" />
          <span className="connectivity-text">{t('connectivity.restored')}</span>
        </>
      ) : (
        <>
          <span className="connectivity-spinner" aria-hidden="true" />
          <span className="connectivity-text">{text}</span>
          {/* Beside the layer's name, the wait until the next attempt: both
              pieces of the current process, rather than one hiding the other. */}
          {phase === 'retrying' && secondsLeft > 0 && (
            <span className="connectivity-countdown">
              {t('connectivity.reconnecting', { seconds: secondsLeft })}
            </span>
          )}
        </>
      )}
    </div>
  )
}
