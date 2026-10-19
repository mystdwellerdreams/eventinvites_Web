import { useState, useRef, useEffect } from 'react'
import type { Event } from '../types'
import {
  buildEventShareText,
  eventPageUrl,
  telegramShareUrl,
  whatsappShareUrl,
} from '../utils/eventShare'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import './ShareMenu.css'
import { useI18n } from '../i18n'

interface ShareMenuProps {
  event: Event
  /** Interface locale, so the shared date reads like the page's. */
  locale?: string
}

/**
 * The share menu on an event page: WhatsApp, Telegram, or copying
 * the generated text. The trigger sits in the page header corner,
 * next to the administrator's Edit button.
 */
export default function ShareMenu({ event, locale }: ShareMenuProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // The chat apps render the date and location emoji;
  // the copied text stays plain.
  const copyText = buildEventShareText(event, locale, 'copy')
  const whatsappText = buildEventShareText(event, locale, 'whatsapp')
  const telegramText = buildEventShareText(event, locale, 'telegram')
  const url = eventPageUrl(event)

  // Keeps the dropdown inside the screen, flipping it
  // above the trigger when there is no room below.
  const menuStyle = useDropdownPosition(open, ref, menuRef)

  const copy = async () => {
    setCopied(false)
    setFailed(false)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(copyText)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 2500)
      } else {
        throw new Error(t('share.unavailable'))
      }
    } catch {
      // Clipboard needs a secure context. The text is offered in a
      // field so it can still be selected and copied by hand.
      setFailed(true)
    }
  }

  return (
    <div className="share-menu" ref={ref}>
      <button
        type="button"
        className="btn btn-secondary btn-sm ep-share-link"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {t('event.share')} ▾
      </button>
      {open && (
        <div
          className="share-menu-dropdown"
          role="menu"
          ref={menuRef}
          style={menuStyle}
        >
          <a
            href={whatsappShareUrl(whatsappText)}
            target="_blank"
            rel="noopener noreferrer"
            className="share-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <span className="share-menu-icon" aria-hidden="true">
              💬
            </span>
            <span className="share-menu-text">
              <strong>WhatsApp</strong>
            </span>
          </a>
          <a
            href={telegramShareUrl(telegramText, url)}
            target="_blank"
            rel="noopener noreferrer"
            className="share-menu-item"
            role="menuitem"
            onClick={() => setOpen(false)}
          >
            <span className="share-menu-icon" aria-hidden="true">
              ✈️
            </span>
            <span className="share-menu-text">
              <strong>Telegram</strong>
            </span>
          </a>
          <button
            type="button"
            className="share-menu-item"
            role="menuitem"
            onClick={copy}
          >
            <span className="share-menu-icon" aria-hidden="true">
              📋
            </span>
            <span className="share-menu-text">
              <strong>{copied ? t('share.copied') : t('share.copyText')}</strong>
            </span>
          </button>
          {failed && (
            <>
              <p className="share-menu-note">{t('share.copyFailedHint')}</p>
              <textarea
                className="share-menu-fallback"
                readOnly
                rows={4}
                value={copyText}
                aria-label={t('share.textLabel')}
                onFocus={(e) => e.currentTarget.select()}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}
