import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useI18n } from '../i18n'
import './ToolboxNav.css'

/** One jump target: a section of the page the toolbox can open. */
export interface ToolboxSection {
  /** The id of the section's element. */
  id: string
  /** A short glyph shown on the section's round button. */
  icon: string
  /** What the button opens, shown as its tooltip and its label. */
  label: string
}

/**
 * The page's navigation toolbox: a round compass button pinned to the
 * bottom corner, a smaller back-to-top button above it that appears once
 * the page is scrolled half a screen down, and — opened from the compass
 * — one round button per section, stacked between the two.
 *
 * Clicking a section's button scrolls the page to it, stopping below the
 * sticky header and any sticky bar the page keeps beneath it. When the
 * buttons no longer fit between those and the corner, the column fills
 * the space available instead: the back-to-top button moves up under the
 * sticky bars and the section buttons become a scrolling list.
 *
 * The toolbox only renders where a page implements this navigation, so
 * it is simply not mounted anywhere else. When a pinned panel — a save
 * bar, say — owns the bottom edge, the toolbox is measured against it
 * and sits above it rather than over it.
 */
export default function ToolboxNav({
  sections,
  /** The sticky header the scroll stops below, and never covers. */
  headerSelector = '.header',
  /**
   * A page's own sticky elements between the header and the content — an
   * event page's title bar, say — which the scroll also stops below and
   * the column stays clear of. Given as CSS selectors.
   */
  stickySelectors = [],
  /**
   * A pinned element at the bottom of the page — a save bar — which the
   * toolbox must sit above. Given as a CSS selector.
   */
  avoid,
}: {
  sections: ToolboxSection[]
  headerSelector?: string
  stickySelectors?: string[]
  avoid?: string
}) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  /** True once the page is scrolled half a screen height down. */
  const [showTop, setShowTop] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [headerHeight, setHeaderHeight] = useState(64)
  const [stickyHeight, setStickyHeight] = useState(0)
  const [avoidHeight, setAvoidHeight] = useState(0)

  /* ------------------------------- measuring ------------------------------- */

  // The header, the page's own sticky bars and the pinned panel are
  // measured rather than assumed: each changes height between landscape
  // and portrait, and with it.
  useEffect(() => {
    const header = document.querySelector(headerSelector)
    if (!header) return
    const measure = () => setHeaderHeight(header.getBoundingClientRect().height || 64)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    return () => observer.disconnect()
  }, [headerSelector])

  // The selectors' identity, so the measuring effect is not resubscribed
  // on every render: the page hands a fresh array in each time.
  const stickyKey = stickySelectors.join('\u0000')

  useEffect(() => {
    const nodes = stickyKey
      .split('\u0000')
      .map((selector) => document.querySelector(selector))
      .filter((node): node is Element => Boolean(node))
    if (nodes.length === 0) return
    const measure = () =>
      setStickyHeight(
        nodes.reduce((sum, node) => sum + node.getBoundingClientRect().height, 0)
      )
    measure()
    const observer = new ResizeObserver(measure)
    nodes.forEach((node) => observer.observe(node))
    return () => observer.disconnect()
  }, [stickyKey])

  useEffect(() => {
    if (!avoid) return
    const panel = document.querySelector(avoid)
    if (!panel) return
    const measure = () => setAvoidHeight(panel.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel)
    return () => observer.disconnect()
  }, [avoid])

  /** Everything standing between the top of the viewport and the content:
   *  the header, and any sticky bars the page itself keeps there. */
  const topOffset = headerHeight + stickyHeight

  /* -------------------------------- scrolling ------------------------------- */

  // The sections' identity, so the scroll listener is not resubscribed on
  // every render: the page hands a fresh array in each time.
  const sectionIds = sections.map((section) => section.id).join(',')

  const recompute = useCallback(() => {
    // Half a screen height down, the button for going back up appears.
    setShowTop(window.scrollY >= window.innerHeight / 2)
    // The section in view is the last one to have reached the reading
    // line just below everything pinned at the top.
    const line = topOffset + 120
    let current: string | null = null
    for (const id of sectionIds ? sectionIds.split(',') : []) {
      const el = document.getElementById(id)
      if (!el) continue
      if (el.getBoundingClientRect().top <= line) current = id
    }
    setActiveId(current)
  }, [sectionIds, topOffset])

  useEffect(() => {
    recompute()
    window.addEventListener('scroll', recompute, { passive: true })
    window.addEventListener('resize', recompute)
    return () => {
      window.removeEventListener('scroll', recompute)
      window.removeEventListener('resize', recompute)
    }
  }, [recompute])

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    // The scroll target is the section's top edge, lifted clear of the
    // header and any sticky bar so the heading stays visible under them.
    const top = el.getBoundingClientRect().top + window.scrollY - topOffset - 8
    window.scrollTo({ top: Math.max(top, 0), behavior: 'smooth' })
    setOpen(false)
  }
  /* --------------------------------- closing -------------------------------- */

  // A click outside the toolbox, or Escape, puts the buttons away again.
  useEffect(() => {
    if (!open) return
    const onDocumentClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onDocumentClick)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('click', onDocumentClick)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const style = {
    '--tb-header': `${headerHeight}px`,
    '--tb-sticky': `${stickyHeight}px`,
    '--tb-avoid': `${avoidHeight}px`,
  } as CSSProperties

  return (
    <div className="toolbox" ref={rootRef} style={style}>
      {/* Above the compass: the smaller back-to-top, once the page has
          been scrolled half a screen. */}
      {showTop && (
        <button
          type="button"
          className="toolbox-top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title={t('toolbox.backToTop')}
          aria-label={t('toolbox.backToTop')}
        >
          <span aria-hidden="true">↑</span>
        </button>
      )}

      {open && (
        <nav className="toolbox-menu" aria-label={t('toolbox.menu')}>
          {sections.map((section) => (
            <button
              key={section.id}
              type="button"
              className={`toolbox-item ${activeId === section.id ? 'is-active' : ''}`}
              onClick={() => scrollToSection(section.id)}
              title={section.label}
              aria-label={section.label}
              aria-current={activeId === section.id ? 'true' : undefined}
            >
              <span aria-hidden="true">{section.icon}</span>
            </button>
          ))}
        </nav>
      )}

      <button
        type="button"
        className="toolbox-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={open ? t('toolbox.close') : t('toolbox.open')}
        aria-label={open ? t('toolbox.close') : t('toolbox.open')}
      >
        <span aria-hidden="true">🧭</span>
      </button>
    </div>
  )
}
