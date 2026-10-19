import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../utils/env'

/** One connection layer's state. */
export type LayerState = 'ok' | 'down'

/** What the controller knows about each layer. */
export interface ConnectivityStatus {
  /** The browser's own connection: `navigator.onLine`. */
  internet: LayerState
  /** Whether the app's own endpoint answers at all. */
  server: LayerState
  /** Whether the database answered the health check. */
  database: LayerState
  /** Whether the upload store answered the health check. */
  storage: LayerState
}

/** What the controller is doing right now. */
export type ConnectivityPhase = 'idle' | 'probing' | 'retrying'

/** Where the health check lives. */
const HEALTH_URL = `${API_BASE}/health`
/**
 * Where the internet at large is checked, and only ever when our own origin
 * cannot be reached. The request is cross-origin with no credentials and no
 * body, so it reveals nothing about the visitor; an answer of any kind
 * means there is a working route out, and a rejection means there is not.
 * This is the same endpoint the browsers themselves use for their own
 * connectivity checks.
 */
const INTERNET_CHECK_URL = 'https://connectivitycheck.gstatic.com/generate_204'
/** How long the internet check may take before it gives up. */
const INTERNET_CHECK_TIMEOUT_MS = 3000

/** How long between probes while everything is healthy. */
const HEALTHY_INTERVAL_MS = 20000
/** The shortest wait before the first retry after a failure. */
const FIRST_RETRY_MS = 1000
/** The longest wait between retries, however long the outage lasts. */
const MAX_RETRY_MS = 15000
/** How stale a check may be before a page becoming visible probes again. */
const STALE_AFTER_MS = 5000
/**
 * Traffic failures ask for an immediate probe, but a page mid-outage can
 * fire dozens of them a second, so the requests are spaced out.
 */
const REPORT_THROTTLE_MS = 2000
/** How long the "connection restored" confirmation stays up. */
const RESTORED_MS = 3000

const initialStatus: ConnectivityStatus = {
  internet: 'ok',
  server: 'ok',
  database: 'ok',
  storage: 'ok',
}

/** Reports a failed request from anywhere in the app, so the controller
 *  reacts to real traffic rather than only to its own polling. A set rather
 *  than one slot, so one instance unmounting cannot silence another's. */
const trafficReporters = new Set<() => void>()

/**
 * Told whenever a request failed, which is the controller's evidence that
 * the network is in trouble. A subsystem that depends on loading something
 * over that network — the CAPTCHA script, say — listens here so it can fall
 * back without waiting for its own failure to surface.
 */
const troubleListeners = new Set<() => void>()

export function noteTrafficFailure(): void {
  for (const report of trafficReporters) report()
  for (const listen of troubleListeners) listen()
}

/** Subscribes to connection trouble; returns the unsubscribe function. */
export function onConnectionTrouble(listener: () => void): () => void {
  troubleListeners.add(listener)
  return () => {
    troubleListeners.delete(listener)
  }
}

/**
 * Watches the three connections the app depends on — the internet, the
 * database and the upload store — and drives the indicator that says which
 * one is unavailable and what is being done about it.
 *
 * Probing is deliberately cheap while everything is healthy, and backs off
 * exponentially while something is wrong: a page stuck mid-outage should
 * not hammer the server it is trying to reach. A page that becomes visible
 * again probes at once, which is also how a reconnect after a server
 * update is picked up.
 */
export function useConnectivity() {
  const [status, setStatus] = useState<ConnectivityStatus>(initialStatus)
  const [phase, setPhase] = useState<ConnectivityPhase>('idle')
  /** Seconds left before the next probe, while waiting to retry. */
  const [secondsLeft, setSecondsLeft] = useState(0)
  /** True for a moment after the connections come back. */
  const [restored, setRestored] = useState(false)

  const attempt = useRef(0)
  const retryTimer = useRef<number | null>(null)
  const tickTimer = useRef<number | null>(null)
  const restoreTimer = useRef<number | null>(null)
  const lastProbeAt = useRef(0)
  const lastReportAt = useRef(0)
  const mounted = useRef(true)
  /** Whether the page is showing a connection problem right now. */
  const wasDown = useRef(false)

  const clearTimers = () => {
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current)
      retryTimer.current = null
    }
    if (tickTimer.current !== null) {
      window.clearInterval(tickTimer.current)
      tickTimer.current = null
    }
  }

  /** Waits `delay`, counting the seconds down for the indicator. */
  const scheduleRetry = useCallback((delay: number) => {
    clearTimers()
    setPhase('retrying')
    setSecondsLeft(Math.ceil(delay / 1000))
    tickTimer.current = window.setInterval(() => {
      setSecondsLeft((s) => (s > 1 ? s - 1 : 1))
    }, 1000)
    retryTimer.current = window.setTimeout(() => {
      void probe()
    }, delay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])



  /**
   * Whether the internet itself is reachable. `navigator.onLine` only says
   * the machine has a network link — it stays true on a Wi-Fi connection
   * with no route out — so the real question is answered by reaching
   * somewhere else and seeing whether anything comes back.
   */
  const internetReachable = useCallback(async (): Promise<boolean> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), INTERNET_CHECK_TIMEOUT_MS)
    try {
      // No credentials and no read of the answer: an opaque response of
      // any status proves the route, so only a rejection says otherwise.
      await fetch(INTERNET_CHECK_URL, {
        mode: 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal,
      })
      return true
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }, [])

  /** One round of probing: everything the controller can learn at once. */
  const probe = useCallback(async () => {
    if (!mounted.current) return
    clearTimers()
    setPhase('probing')
    setSecondsLeft(0)
    lastProbeAt.current = Date.now()

    const online = typeof navigator === 'undefined' ? true : navigator.onLine

    try {
      const response = await fetch(HEALTH_URL, { cache: 'no-store' })
      // The body is read even on a 503: that is the answer "reachable, but
      // a layer is down", which is not the same as no connection at all.
      const body = (await response.json().catch(() => null)) as {
        database?: string
        storageReady?: string
      } | null

      // A probe in flight when the component went away stops here: its
      // state writes and the interval it would schedule would have nothing
      // left to clean them up.
      if (!mounted.current) return

      if (!body) throw new Error('Health check answered nothing usable')

      const next: ConnectivityStatus = {
        internet: online ? 'ok' : 'down',
        server: 'ok',
        database: body.database === 'ok' ? 'ok' : 'down',
        storage: body.storageReady === 'ok' ? 'ok' : 'down',
      }
      setStatus(next)

      const healthy =
        next.internet === 'ok' &&
        next.server === 'ok' &&
        next.database === 'ok' &&
        next.storage === 'ok'
      if (healthy) {
        // Only a clean bill of health resets the backoff: a reachable but
        // degraded answer keeps accruing it, or a database that answers
        // "down" forever would be polled every second.
        attempt.current = 0
        setPhase('idle')
        clearTimers()
        // Coming back from a problem is worth one word: the reader was
        // told something was wrong and now knows it is not.
        if (wasDown.current) {
          wasDown.current = false
          setRestored(true)
          if (restoreTimer.current !== null) window.clearTimeout(restoreTimer.current)
          restoreTimer.current = window.setTimeout(() => {
            setRestored(false)
            restoreTimer.current = null
          }, RESTORED_MS)
        }
        retryTimer.current = window.setTimeout(() => void probe(), HEALTHY_INTERVAL_MS)
      } else {
        wasDown.current = true
        scheduleRetry(nextRetryDelay())
      }
    } catch {
      // The endpoint did not answer. With no link at all the browser says
      // so; with a link it could still be the internet that is gone rather
      // than the server, so somewhere else is asked before blaming ours.
      if (!mounted.current) return
      if (online && (await internetReachable())) {
        // The internet answers, so the failure is on our side of it.
        setStatus({
          internet: 'ok',
          server: 'down',
          database: 'down',
          storage: 'down',
        })
      } else {
        setStatus({
          internet: 'down',
          server: 'down',
          database: 'down',
          storage: 'down',
        })
      }
      wasDown.current = true
      scheduleRetry(nextRetryDelay())
    }
  }, [internetReachable, scheduleRetry])

  /** The next backoff step, doubling up to the ceiling. */
  function nextRetryDelay(): number {
    const delay = Math.min(FIRST_RETRY_MS * 2 ** attempt.current, MAX_RETRY_MS)
    attempt.current += 1
    return delay
  }



  /** An immediate probe, asked for by traffic that just failed. */
  const probeNow = useCallback(() => {
    const now = Date.now()
    if (now - lastReportAt.current < REPORT_THROTTLE_MS) return
    lastReportAt.current = now
    void probe()
  }, [probe])

  // The traffic reporter the rest of the app calls into.
  useEffect(() => {
    trafficReporters.add(probeNow)
    return () => {
      trafficReporters.delete(probeNow)
    }
  }, [probeNow])

  // The browser's own connection coming and going.
  useEffect(() => {
    const onOnline = () => void probe()
    const onOffline = () => {
      setStatus((s) => ({ ...s, internet: 'down' }))
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [probe])

  // A page coming back into view probes if its last check has gone stale:
  // this is where a reconnect after a server update is picked up.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastProbeAt.current > STALE_AFTER_MS) void probe()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [probe])

  // The first check starts on mount; the loop keeps itself going.
  useEffect(() => {
    mounted.current = true
    void probe()
    return () => {
      mounted.current = false
      clearTimers()
      if (restoreTimer.current !== null) {
        window.clearTimeout(restoreTimer.current)
        restoreTimer.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible =
    status.internet === 'down' ||
    status.server === 'down' ||
    status.database === 'down' ||
    status.storage === 'down'

  return { status, phase, secondsLeft, visible, restored }
}

/**
 * What the indicator names as the problem: the layer that is unavailable.
 * The countdown is shown beside it rather than instead of it — a reader
 * wants to know which connection is broken and when the next attempt comes,
 * not one or the other.
 */
export function connectivityMessage(
  status: ConnectivityStatus
): string {
  if (status.internet === 'down') return 'connectivity.internet'
  if (status.server === 'down') return 'connectivity.server'
  if (status.database === 'down') return 'connectivity.database'
  if (status.storage === 'down') return 'connectivity.storage'
  return 'connectivity.probing'
}
