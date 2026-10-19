import { useEffect, useMemo, useState } from 'react'
import { bannersAPI } from '../utils/api'
import BannerAdView from './BannerAdView'
import type { BannerAd, BannerSlot } from '../types'
import './BannerHero.css'

/**
 * The home page hero, replaced by a banner layout: a main
 * banner with side banners on either side. Side banners hold a
 * single ad; the main banner rotates through its ads. On narrow
 * screens the banners stack — left, main, right.
 */
export default function BannerHero() {
  const [slots, setSlots] = useState<BannerSlot[]>([])

  useEffect(() => {
    let cancelled = false
    bannersAPI
      .list()
      .then((r) => {
        if (!cancelled) setSlots(r.data.slots)
      })
      .catch(() => {
        // Without banners the hero simply stays empty.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const bySlot = useMemo(() => {
    const map: Partial<Record<BannerSlot['slot'], BannerSlot>> = {}
    for (const slot of slots) map[slot.slot] = slot
    return map
  }, [slots])

  const left = bySlot.LEFT?.ads?.length ? bySlot.LEFT : undefined
  const main = bySlot.MAIN?.ads?.length ? bySlot.MAIN : undefined
  const right = bySlot.RIGHT?.ads?.length ? bySlot.RIGHT : undefined

  if (!left && !main && !right) return null

  // Side banners take a third of the section, or half when the
  // main banner is absent; the main banner fills the rest.
  let template: string
  if (left && main && right) template = '1fr 1fr 1fr'
  else if (left && main) template = '1fr 2fr'
  else if (main && right) template = '2fr 1fr'
  else if (main) template = '1fr'
  else if (left && right) template = '1fr 1fr'
  else template = '1fr'

  return (
    <section
      id="announcements"
      className="banner-hero"
      style={{ gridTemplateColumns: template }}
      aria-label="Banners"
    >
      {left && (
        <div className="banner-hero-slot">
          <BannerSlotView slot={left} />
        </div>
      )}
      {main && (
        <div className="banner-hero-slot">
          <BannerSlotView slot={main} />
        </div>
      )}
      {right && (
        <div className="banner-hero-slot">
          <BannerSlotView slot={right} />
        </div>
      )}
    </section>
  )
}

function BannerSlotView({ slot }: { slot: BannerSlot }) {
  const ads = slot.ads ?? []
  if (slot.slot === 'MAIN') {
    return <MainBanner ads={ads} interval={slot.interval} />
  }
  const ad = ads[0]
  return ad ? <BannerAdView ad={ad} /> : null
}

/**
 * Rotates the main banner's ads at the slot's interval. An
 * ANNOUNCEMENT takes priority: it displays immediately on page
 * load, whatever its position in the sequence, and stays for its
 * configured duration before the rotation begins.
 *
 * The rotation uses a timeout keyed on the current slide, so
 * every slide change — automatic or manual — restarts the full
 * interval instead of firing early.
 */
function MainBanner({
  ads,
  interval,
}: {
  ads: BannerAd[]
  interval: number
}) {
  const announcement = ads.find((a) => a.type === 'ANNOUNCEMENT')
  const [phase, setPhase] = useState<'announcement' | 'rotation'>(
    announcement ? 'announcement' : 'rotation'
  )
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (phase === 'announcement' && announcement) {
      const timer = setTimeout(
        () => setPhase('rotation'),
        Math.max(1, announcement.duration) * 1000
      )
      return () => clearTimeout(timer)
    }
    if (ads.length < 2) return
    const timer = setTimeout(
      () => setIndex((i) => (i + 1) % ads.length),
      Math.max(2, interval) * 1000
    )
    return () => clearTimeout(timer)
  }, [phase, announcement, ads, interval, index])

  const current =
    phase === 'announcement' && announcement ? announcement : ads[index]
  if (!current) return null

  const isDotActive = (ad: BannerAd, i: number): boolean => {
    if (phase === 'announcement') {
      return announcement !== undefined && ad.id === announcement.id
    }
    return i === index
  }

  return (
    <div className="main-banner">
      <BannerAdView key={`${current.id}-${phase}-${index}`} ad={current} />
      {ads.length > 1 && (
        <div className="main-banner-dots" role="tablist" aria-label="Banner ads">
          {ads.map((ad, i) => (
            <button
              key={ad.id}
              type="button"
              role="tab"
              aria-selected={isDotActive(ad, i)}
              aria-label={`Ad ${i + 1}`}
              className={`main-banner-dot${
                isDotActive(ad, i) ? ' is-active' : ''
              }`}
              onClick={() => {
                setPhase('rotation')
                setIndex(i)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
