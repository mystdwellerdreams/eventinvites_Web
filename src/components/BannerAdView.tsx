import { useEffect, useMemo, useRef, useState } from 'react'
import { bannersAPI, apiErrorMessage, resolveAssetUrl } from '../utils/api'
import { useI18n } from '../i18n'
import { useAuth } from '../context/AuthContext'
import type {
  BannerAd,
  BannerAnnouncementConfig,
  BannerConfig,
  BannerContactItem,
  BannerContactsConfig,
  BannerCoverConfig,
  BannerCounterConfig,
  BannerPollConfig,
} from '../types'

/**
 * Renders a single banner ad. The type decides the layout; every
 * type fills the banner area it is placed in.
 */
export default function BannerAdView({ ad }: { ad: BannerAd }) {
  const config = (ad.config ?? {}) as BannerConfig
  switch (ad.type) {
    case 'COVER':
      return <CoverAd config={config as BannerCoverConfig} />
    case 'COUNTER':
      return <CounterAd ad={ad} config={config as BannerCounterConfig} />
    case 'POLL':
      return <PollAd ad={ad} config={config as BannerPollConfig} />
    case 'CONTACTS':
      return <ContactsAd config={config as BannerContactsConfig} />
    case 'ANNOUNCEMENT':
      return <AnnouncementAd config={config as BannerAnnouncementConfig} />
    default:
      return null
  }
}

/* ---------------------------------- cover --------------------------------- */

function CoverAd({ config }: { config: BannerCoverConfig }) {
  const style: React.CSSProperties = {}
  if (config.backgroundType === 'image' && config.imageUrl) {
    style.backgroundImage = `url("${resolveAssetUrl(config.imageUrl)}")`
  } else if (config.backgroundType === 'gradient') {
    style.background = `linear-gradient(135deg, ${
      config.gradientFrom || '#3b82f6'
    }, ${config.gradientTo || '#8b5cf6'})`
  } else {
    style.backgroundColor = config.color || '#3b82f6'
  }

  // The headline and the description are styled independently, the way an
  // event page styles its title and body.
  const textStyle: React.CSSProperties = {}
  if (config.fontFamily) textStyle.fontFamily = config.fontFamily
  if (config.fontSize) textStyle.fontSize = config.fontSize

  const descriptionStyle: React.CSSProperties = {}
  if (config.descriptionFontFamily) descriptionStyle.fontFamily = config.descriptionFontFamily
  if (config.descriptionFontSize) descriptionStyle.fontSize = config.descriptionFontSize
  if (config.descriptionFontColor) descriptionStyle.color = config.descriptionFontColor

  return (
    <div
      className={`banner-ad banner-ad--cover banner-ad--align-${
        config.alignment || 'center'
      } banner-ad--v-${config.verticalAlignment || 'center'}`}
      style={style}
    >
      <div className="banner-ad-textblock">
        {config.text && (
          <p
            className="banner-ad-text"
            style={{ color: config.fontColor || '#ffffff', ...textStyle }}
          >
            {config.text}
          </p>
        )}
        {config.description && (
          <p
            className={`banner-ad-description banner-ad-description--align-${
              config.descriptionAlignment || 'center'
            }`}
            style={descriptionStyle}
          >
            {config.description}
          </p>
        )}
      </div>
    </div>
  )
}

/* --------------------------------- counter -------------------------------- */

/** Splits the details text, keeping @handles as their own segments. */
const MENTION_SPLIT = /(@\S+)/g

/**
 * Copies text to the clipboard, falling back to a hidden
 * textarea when the async clipboard API is unavailable.
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    return true
  } catch {
    return false
  }
}

/** The details text, with @handles as tappable copy buttons.
 *  The @ marker itself is neither shown nor copied. Every successful copy
 *  is reported, so the administrator's panel can see who took what. */
function CounterDetails({ adId, text }: { adId: string; text: string }) {
  const { t } = useI18n()
  const { user } = useAuth()
  const [copied, setCopied] = useState(false)
  const hideTimer = useRef<number | undefined>(undefined)

  const copy = async (reference: string) => {
    if (!(await copyToClipboard(reference))) return
    setCopied(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setCopied(false), 2500)
    // Only a signed-in copy is attributed; a visitor's is not recorded.
    if (user) {
      bannersAPI.copy(adId, reference).catch(() => {
        // A failed report never spoils the copy the user just made.
      })
    }
  }

  return (
    <>
      {text.split(MENTION_SPLIT).map((segment, index) =>
        index % 2 === 1 ? (
          <button
            key={index}
            type="button"
            className="counter-mention"
            onClick={(e) => {
              e.stopPropagation()
              void copy(segment.slice(1))
            }}
            title={t('banner.copyMention')}
            aria-label={`${t('banner.copyMention')}: ${segment.slice(1)}`}
          >
            {segment.slice(1)}
          </button>
        ) : (
          <span key={index}>{segment}</span>
        )
      )}
      {copied && (
        <span className="counter-copied" role="status">
          {t('banner.copied')}
        </span>
      )}
    </>
  )
}

function CounterAd({ ad, config }: { ad: BannerAd; config: BannerCounterConfig }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const ratio = config.target > 0 ? config.current / config.target : 0
  const pct = Math.min(100, Math.round(ratio * 100))

  const style: React.CSSProperties = {}
  if (config.backgroundType === 'image' && config.imageUrl) {
    style.backgroundImage = `url("${resolveAssetUrl(config.imageUrl)}")`
    style.backgroundSize = 'cover'
    style.backgroundPosition = 'center'
  } else if (config.backgroundType === 'gradient') {
    style.background = `linear-gradient(135deg, ${
      config.gradientFrom || '#3b82f6'
    }, ${config.gradientTo || '#8b5cf6'})`
  } else if (config.backgroundType === 'color') {
    style.backgroundColor = config.color || '#3b82f6'
  }

  const currency = config.currency ?? ''
  // The value's symbol sits at the end: 50%, 250$, 0 / 100$.
  const display =
    config.valueDisplay === 'current'
      ? `${config.current}${currency}`
      : config.valueDisplay === 'target'
        ? `${config.target}${currency}`
        : config.valueDisplay === 'raw'
          ? `${config.current} / ${config.target}${currency}`
          : `${pct}%`

  return (
    <div className="banner-ad banner-ad--counter" style={style}>
      <button
        type="button"
        className="counter-body"
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
        aria-expanded={open}
      >
        {config.label && <p className="counter-label">{config.label}</p>}
        {config.style === 'circle' ? (
          <CounterCircle pct={pct} display={display} />
        ) : (
          <CounterBar pct={pct} display={display} />
        )}
        {config.caption && <p className="counter-caption">{config.caption}</p>}
      </button>
      {open && config.details && (
        <div className="counter-details">
          <CounterDetails adId={ad.id} text={config.details} />
        </div>
      )}
      {config.details && (
        <p className="counter-details-hint">{t('banner.tapForDetails')}</p>
      )}
    </div>
  )
}

function CounterBar({ pct, display }: { pct: number; display: string }) {
  return (
    <div className="counter-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="counter-bar-fill" style={{ width: `${pct}%` }} />
      <span className="counter-bar-label">{display}</span>
    </div>
  )
}

function CounterCircle({ pct, display }: { pct: number; display: string }) {
  const r = 34
  const circumference = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 80 80" className="counter-circle" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <circle cx="40" cy="40" r={r} className="counter-circle-bg" />
      <circle
        cx="40"
        cy="40"
        r={r}
        className="counter-circle-fill"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct / 100)}
      />
      <text
        x="40"
        y="45"
        textAnchor="middle"
        className={`counter-circle-label${
          display.length > 6 ? ' counter-circle-label--small' : ''
        }`}
      >
        {display}
      </text>
    </svg>
  )
}

/* ---------------------------------- poll ---------------------------------- */

/** How long a poll choice is locked before it can be changed. */
const POLL_COOLDOWN_MS = 5000

const pollChoiceKey = (adId: string) => `banner-poll:${adId}`
const pollCooldownKey = (adId: string) => `banner-poll-cooldown:${adId}`

function readPollChoice(adId: string): string | null {
  if (typeof localStorage === 'undefined') return null
  try {
    return localStorage.getItem(pollChoiceKey(adId))
  } catch {
    return null
  }
}

function writePollChoice(adId: string, optionId: string) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(pollChoiceKey(adId), optionId)
  } catch {
    // A blocked storage API just means the choice lasts this session.
  }
}

function clearPollChoice(adId: string) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(pollChoiceKey(adId))
  } catch {
    // Nothing to clear.
  }
}

function readPollCooldown(adId: string): number {
  if (typeof localStorage === 'undefined') return 0
  try {
    const value = Number(localStorage.getItem(pollCooldownKey(adId)))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function writePollCooldown(adId: string, end: number) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(pollCooldownKey(adId), String(end))
  } catch {
    // A blocked storage API just means the cooldown lasts this session.
  }
}

function clearPollCooldown(adId: string) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(pollCooldownKey(adId))
  } catch {
    // Nothing to clear.
  }
}

function PollAd({ ad, config }: { ad: BannerAd; config: BannerPollConfig }) {
  const { t } = useI18n()
  const [options, setOptions] = useState(config.options)
  const [votedId, setVotedId] = useState<string | null>(() =>
    readPollChoice(ad.id)
  )
  const [cooldownEnd, setCooldownEnd] = useState(() => readPollCooldown(ad.id))
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState(false)
  const total = options.reduce((sum, o) => sum + o.votes, 0)

  // Fresh counts on every mount: the ad object the page was built
  // with goes stale as soon as a vote lands, here or elsewhere.
  useEffect(() => {
    let cancelled = false
    bannersAPI
      .get(ad.id)
      .then((r) => {
        if (cancelled) return
        const fresh = (r.data.ad.config as BannerPollConfig).options
        if (fresh?.length) setOptions(fresh)
        // A signed-in user's vote is known to the server even when
        // the browser's memory of it is gone.
        if (r.data.myVote) {
          setVotedId(r.data.myVote)
          writePollChoice(ad.id, r.data.myVote)
        }
      })
      .catch(() => {
        // The initial config is a usable fallback.
      })
    return () => {
      cancelled = true
    }
  }, [ad.id])

  // Keep the clock moving while a cooldown is running.
  useEffect(() => {
    if (!votedId || cooldownEnd <= now) return
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, cooldownEnd - now)
    )
    return () => clearTimeout(timer)
  }, [votedId, cooldownEnd, now])

  const remaining = votedId
    ? Math.max(0, Math.ceil((cooldownEnd - now) / 1000))
    : 0
  const canModify = Boolean(votedId) && remaining === 0

  const applyVote = (updatedAd: BannerAd, optionId: string) => {
    setOptions((updatedAd.config as BannerPollConfig).options)
    setVotedId(optionId)
    writePollChoice(ad.id, optionId)
    const end = Date.now() + POLL_COOLDOWN_MS
    setCooldownEnd(end)
    writePollCooldown(ad.id, end)
    setNow(Date.now())
  }

  const vote = async (optionId: string) => {
    if (busy || votedId) return
    setBusy(true)
    try {
      const r = await bannersAPI.vote(ad.id, optionId)
      applyVote(r.data.ad, optionId)
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banner.voteFailed')))
    } finally {
      setBusy(false)
    }
  }

  const changeVote = async (optionId: string) => {
    if (busy || !votedId || optionId === votedId || !canModify) return
    setBusy(true)
    try {
      const r = await bannersAPI.changeVote(ad.id, optionId, votedId)
      applyVote(r.data.ad, optionId)
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banner.voteFailed')))
    } finally {
      setBusy(false)
    }
  }

  const cancelVote = async () => {
    if (busy || !votedId || !canModify) return
    setBusy(true)
    try {
      const r = await bannersAPI.cancelVote(ad.id, votedId)
      setOptions((r.data.ad.config as BannerPollConfig).options)
      setVotedId(null)
      clearPollChoice(ad.id)
      clearPollCooldown(ad.id)
      setCooldownEnd(0)
      setNow(Date.now())
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banner.voteFailed')))
    } finally {
      setBusy(false)
    }
  }

  const handleResultClick = (optionId: string) => {
    if (busy || !canModify) return
    if (optionId === votedId) {
      void cancelVote()
    } else {
      void changeVote(optionId)
    }
  }

  return (
    <div className="banner-ad banner-ad--poll">
      {config.question && <p className="poll-question">{config.question}</p>}
      <div className="poll-options">
        {options.map((option) => {
          const pct = total > 0 ? Math.round((option.votes / total) * 100) : 0
          if (votedId) {
            const mine = option.id === votedId
            return (
              <button
                key={option.id}
                type="button"
                className={`poll-result${mine ? ' is-mine' : ''}${
                  canModify ? ' is-clickable' : ''
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  handleResultClick(option.id)
                }}
                disabled={busy || !canModify}
                title={
                  mine
                    ? remaining > 0
                      ? t('banner.voteCooldown', { n: remaining })
                      : t('banner.clickToCancel')
                    : canModify
                      ? t('banner.clickToChange')
                      : undefined
                }
              >
                <span
                  className="poll-result-fill"
                  style={{ width: `${pct}%` }}
                  aria-hidden="true"
                />
                <span className="poll-result-text">{option.text}</span>
                <span className="poll-result-count">
                  {pct}% · {option.votes}
                  {mine && remaining > 0 ? ` · ${remaining}s` : ''}
                </span>
              </button>
            )
          }
          return (
              <button
                key={option.id}
                type="button"
                className="poll-option"
                onClick={(e) => {
                  e.stopPropagation()
                  vote(option.id)
                }}
                disabled={busy}
              >
              {option.text}
            </button>
          )
        })}
      </div>
      {votedId && remaining > 0 && (
        <p className="poll-cooldown-hint">
          {t('banner.voteCooldown', { n: remaining })}
        </p>
      )}
      {votedId && remaining === 0 && (
        <p className="poll-cooldown-hint">{t('banner.changeHint')}</p>
      )}
    </div>
  )
}

/* --------------------------------- contacts -------------------------------- */

/** Turns a stored address into the link the platform expects. */
function contactHref(contact: BannerContactItem): string {
  switch (contact.platform) {
    case 'whatsapp':
      return `https://wa.me/${contact.value.replace(/[^\d+]/g, '')}`
    case 'telegram':
      return contact.value.startsWith('@')
        ? `https://t.me/${contact.value.slice(1)}`
        : contact.value.startsWith('http')
          ? contact.value
          : `https://t.me/${contact.value}`
    case 'phone':
      return `tel:${contact.value}`
    case 'email':
      return `mailto:${contact.value}`
    case 'link':
      return contact.value
  }
}

function ContactsAd({ config }: { config: BannerContactsConfig }) {
  const style: React.CSSProperties = {}
  if (config.backgroundType === 'gradient') {
    style.background = `linear-gradient(135deg, ${
      config.gradientFrom || '#3b82f6'
    }, ${config.gradientTo || '#8b5cf6'})`
  } else if (config.backgroundType === 'color') {
    style.backgroundColor = config.backgroundColor || '#3b82f6'
  }

  const buttonStyle: React.CSSProperties = {}
  if (config.buttonStyle === 'outline') {
    const color = config.buttonFontColor || config.buttonColor || '#ffffff'
    buttonStyle.backgroundColor = 'transparent'
    buttonStyle.border = `2px solid ${config.buttonColor || color}`
    buttonStyle.color = color
  } else {
    if (config.buttonColor) buttonStyle.backgroundColor = config.buttonColor
    if (config.buttonFontColor) buttonStyle.color = config.buttonFontColor
  }

  const row = (
    <div className={`contacts-row contacts-align-${config.alignment}`}>
      {config.contacts.map((contact, index) => (
        <a
          key={`${contact.platform}-${index}`}
          className={`contacts-btn contacts-btn--${
            config.buttonStyle || 'filled'
          }`}
          href={contactHref(contact)}
          target={
            contact.platform === 'phone' || contact.platform === 'email'
              ? undefined
              : '_blank'
          }
          rel="noopener noreferrer"
          style={buttonStyle}
        >
          {contact.label}
        </a>
      ))}
    </div>
  )

  return (
    <div
      className={`banner-ad banner-ad--contacts contacts-${config.placement}`}
      style={style}
    >
      {config.placement === 'top' && row}
      <div className="contacts-spacer" aria-hidden="true" />
      {config.placement === 'bottom' && row}
    </div>
  )
}

/* ------------------------------ announcement ------------------------------- */

type AnnouncementBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'table'; header: string[]; rows: string[][] }

const isTableRow = (line: string): boolean => {
  const trimmed = line.trim()
  return trimmed.length > 1 && trimmed.startsWith('|') && trimmed.endsWith('|')
}

const isTableSeparator = (line: string | undefined): boolean => {
  if (!line || !isTableRow(line)) return false
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .every((cell) => /^[\s:-]*$/.test(cell) && cell.includes('-'))
}

const parseTableRow = (line: string): string[] =>
  line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())

/**
 * Splits announcement text into blocks: plain paragraphs, quote
 * blocks (lines starting with `>`) and tables (pipe rows with a
 * `| --- |` separator row).
 */
function parseAnnouncement(text: string): AnnouncementBlock[] {
  const lines = text.split('\n')
  const blocks: AnnouncementBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim().startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quote.push(lines[i].trim().replace(/^>\s?/, ''))
        i++
      }
      const text = quote.join('\n').trim()
      if (text) blocks.push({ kind: 'quote', text })
    } else if (isTableRow(line) && isTableSeparator(lines[i + 1])) {
      const header = parseTableRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(parseTableRow(lines[i]))
        i++
      }
      blocks.push({ kind: 'table', header, rows })
    } else {
      const paragraph: string[] = []
      while (
        i < lines.length &&
        !lines[i].trim().startsWith('>') &&
        !(isTableRow(lines[i]) && isTableSeparator(lines[i + 1]))
      ) {
        paragraph.push(lines[i])
        i++
      }
      const text = paragraph.join('\n').trim()
      if (text) blocks.push({ kind: 'paragraph', text })
    }
  }
  return blocks
}

function AnnouncementAd({
  config,
}: {
  config: BannerAnnouncementConfig
}) {
  const blocks = useMemo(
    () => parseAnnouncement(config.text ?? ''),
    [config.text]
  )
  const style: React.CSSProperties = { color: config.fontColor }
  if (config.fontFamily) style.fontFamily = config.fontFamily
  if (config.fontSize) style.fontSize = config.fontSize
  if (config.backgroundType === 'gradient') {
    style.background = `linear-gradient(135deg, ${
      config.gradientFrom || '#3b82f6'
    }, ${config.gradientTo || '#8b5cf6'})`
  } else {
    style.backgroundColor = config.backgroundColor || '#3b82f6'
  }
  return (
    <div
      className={`banner-ad banner-ad--announcement banner-ad--align-${
        config.alignment || 'center'
      }`}
      style={style}
    >
      {blocks.map((block, index) => {
        if (block.kind === 'quote') {
          return (
            <blockquote key={index} className="announcement-quote">
              {block.text}
            </blockquote>
          )
        }
        if (block.kind === 'table') {
          return (
            <table key={index} className="announcement-table">
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={cellIndex}>{cell}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
        return (
          <p key={index} className="banner-ad-text">
            {block.text}
          </p>
        )
      })}
    </div>
  )
}
