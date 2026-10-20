import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useLocation } from 'react-router-dom'
import Providers from '../../app/providers'
import App from './App'
import '../../src/styles/globals.css'

/**
 * The app build's entry point. It differs from the Next build in exactly two
 * ways: the router is React Router rather than the App Router, and the
 * stylesheet is imported here rather than by a root layout.
 *
 * `CapConfig.html5mode` is true by default, so `BrowserRouter` works and deep
 * paths such as `/events/key/abc` fall back to `index.html` inside the
 * WebView — no hash routing needed.
 */

/**
 * Reproduces what the App Router does on navigation and what the app relies
 * on: a new page starts at the top, and a link that names an anchor scrolls to
 * it once the section has rendered. The anchor targets arrive with an async
 * fetch, so the first attempt may find nothing and one more is made on the
 * next frame.
 */
function ScrollManager() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)

    const hash = location.hash.replace(/^#/, '')
    if (!hash) return

    let cancelled = false
    let retried = false
    let frame = 0

    const scrollToAnchor = () => {
      if (cancelled) return
      const target = document.getElementById(hash)
      if (target) {
        target.scrollIntoView()
        return
      }
      if (!retried) {
        retried = true
        frame = requestAnimationFrame(scrollToAnchor)
      }
    }

    frame = requestAnimationFrame(scrollToAnchor)
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [location.pathname, location.hash])

  return null
}

const container = document.getElementById('root')
if (!container) {
  throw new Error('The root element is missing from index.html')
}

/**
 * The path the site is published under.
 *
 * A site at the root of its host has none, and the router's default is
 * right. A project published under a subpath — a GitHub Pages project site —
 * has one, and the router has to be told so that it does not read the
 * repository's name as part of the route.
 */
createRoot(container).render(
  <StrictMode>
    <BrowserRouter basename={__ROUTER_BASENAME__ || undefined}>
      <Providers>
        <ScrollManager />
        <App />
      </Providers>
    </BrowserRouter>
  </StrictMode>
)
