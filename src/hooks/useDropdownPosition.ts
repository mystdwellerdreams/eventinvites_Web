import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

const GAP = 6
const MARGIN = 8

/** The edges of an element, as `getBoundingClientRect` reports them. */
export interface DropdownRect {
  top: number
  bottom: number
  left: number
  right: number
  height: number
}

export interface DropdownViewport {
  width: number
  height: number
}

/**
 * The inline styles that keep a dropdown fully inside the
 * viewport: flipped above the anchor when there is no room
 * below, shifted sideways when it would run off an edge, and
 * capped in height — so it scrolls — when it is taller than
 * the space on either side.
 */
export function computeDropdownPosition(
  anchor: DropdownRect,
  menu: DropdownRect,
  viewport: DropdownViewport,
  gap: number = GAP,
  margin: number = MARGIN
): CSSProperties {
  const spaceBelow = viewport.height - anchor.bottom - margin
  const spaceAbove = anchor.top - margin

  // Below is the default; flip above only when below does
  // not fit and above does. When neither fits, keep the
  // roomier side and cap the height so the menu scrolls.
  let below = true
  let maxHeight: number | undefined
  if (menu.height <= spaceBelow) {
    below = true
  } else if (menu.height <= spaceAbove) {
    below = false
  } else {
    below = spaceBelow >= spaceAbove
    maxHeight = Math.max(Math.max(spaceBelow, spaceAbove), 40)
  }

  // Shift sideways when the menu would run off a screen edge:
  // left past the left edge, right past the right edge.
  const overflowRight = menu.right - (viewport.width - margin)
  const overflowLeft = margin - menu.left
  const shiftX =
    overflowRight > 0 ? -overflowRight : overflowLeft > 0 ? overflowLeft : 0

  return {
    top: below ? `calc(100% + ${gap}px)` : 'auto',
    bottom: below ? 'auto' : `calc(100% + ${gap}px)`,
    maxHeight,
    overflowY: maxHeight !== undefined ? 'auto' : undefined,
    transform: shiftX !== 0 ? `translateX(${Math.round(shiftX)}px)` : undefined,
  }
}

/**
 * Keeps an absolutely positioned dropdown fully inside the
 * viewport, on top of the page content around it.
 *
 * The menu is anchored to its `position: relative` wrapper by
 * the CSS classes (`top: calc(100% + 6px)`). The position is
 * re-measured whenever the viewport, the scroll position or
 * the menu's own size changes.
 *
 * @param open whether the dropdown is currently shown
 * @param anchorRef the `position: relative` wrapper the menu hangs from
 * @param menuRef the dropdown element itself
 * @returns inline styles to apply to the dropdown element
 */
export function useDropdownPosition(
  open: boolean,
  anchorRef: { current: HTMLElement | null },
  menuRef: { current: HTMLElement | null }
): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({})
  // The last applied position, so a re-measure that changes
  // nothing does not trigger another render (the resize
  // observer below would otherwise loop).
  const appliedRef = useRef<CSSProperties>({})

  useEffect(() => {
    if (!open) {
      appliedRef.current = {}
      setStyle({})
      return
    }
    const anchor = anchorRef.current
    const menu = menuRef.current
    if (!anchor || !menu) return

    const apply = (next: CSSProperties) => {
      const prev = appliedRef.current
      const same =
        prev.top === next.top &&
        prev.bottom === next.bottom &&
        prev.transform === next.transform &&
        prev.maxHeight === next.maxHeight &&
        prev.overflowY === next.overflowY
      if (same) return
      appliedRef.current = next
      setStyle(next)
    }

    const measure = () => {
      apply(
        computeDropdownPosition(
          anchor.getBoundingClientRect(),
          menu.getBoundingClientRect(),
          { width: window.innerWidth, height: window.innerHeight }
        )
      )
    }

    // Measure after paint, once the menu's own size is known.
    const frame = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    const observer = new ResizeObserver(measure)
    observer.observe(menu)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      observer.disconnect()
    }
  }, [open, anchorRef, menuRef])

  return style
}
