import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveAssetUrl } from '../utils/api'
import './ImageCarousel.css'
import { useI18n } from '../i18n'

interface ImageCarouselProps {
  images: string[]
  alt: string
  /** Forwarded to the frame so per-element styling still applies. */
  style?: React.CSSProperties
  className?: string
}

/** Horizontal swipe distance, in pixels, that counts as a deliberate change. */
const SWIPE_THRESHOLD = 40

/**
 * Shows one image at a time with previous/next controls, and supports
 * swiping left and right (pointer and touch). With a single image it renders
 * plainly, with no controls.
 */
export default function ImageCarousel({
  images,
  alt,
  style,
  className = '',
}: ImageCarouselProps) {
  const { t } = useI18n()
  const [index, setIndex] = useState(0)
  const dragStart = useRef<number | null>(null)

  // A changed image list can leave the index past the end.
  useEffect(() => {
    setIndex((current) => (current >= images.length ? 0 : current))
  }, [images.length])

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => (current + delta + images.length) % images.length)
    },
    [images.length]
  )

  const onPointerDown = (e: React.PointerEvent) => {
    dragStart.current = e.clientX
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragStart.current === null) return
    const delta = e.clientX - dragStart.current
    dragStart.current = null
    if (Math.abs(delta) < SWIPE_THRESHOLD) return
    go(delta < 0 ? 1 : -1)
  }

  if (images.length === 0) return null

  // Stored paths are relative to the API, which is a separate origin now.
  const sources = images.map((src) => resolveAssetUrl(src) ?? src)

  if (sources.length === 1) {
    return (
      <img
        src={sources[0]}
        alt={alt}
        className={`ep-cover ${className}`.trim()}
        style={style}
      />
    )
  }

  return (
    <div
      className={`ep-carousel ${className}`.trim()}
      style={style}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        dragStart.current = null
      }}
    >
      <img
        key={images[index]}
        src={sources[index]}
        alt={`${alt} (${index + 1} of ${images.length})`}
        className="ep-carousel-image"
        draggable={false}
      />

      <button
        type="button"
        className="ep-carousel-nav ep-carousel-prev"
        onClick={() => go(-1)}
        aria-label={t('carousel.previousImage')}
      >
        ‹
      </button>
      <button
        type="button"
        className="ep-carousel-nav ep-carousel-next"
        onClick={() => go(1)}
        aria-label={t('carousel.nextImage')}
      >
        ›
      </button>

      <div className="ep-carousel-dots" role="tablist" aria-label={t('carousel.chooseImage')}>
        {sources.map((url, i) => (
          <button
            key={`${url}-${i}`}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={t('carousel.imageN', { n: i + 1 })}
            className={`ep-carousel-dot ${i === index ? 'is-active' : ''}`}
            onClick={() => setIndex(i)}
          />
        ))}
      </div>

      <span className="ep-carousel-counter">
        {index + 1} / {images.length}
      </span>
    </div>
  )
}
