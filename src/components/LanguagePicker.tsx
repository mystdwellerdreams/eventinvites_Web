import { useEffect, useRef, useState } from 'react'
import { useI18n, LOCALES, LOCALE_NAMES, type Locale } from '../i18n'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import './LanguagePicker.css'

const SHORT: Record<Locale, string> = { en: 'EN', ru: 'RU' }

export default function LanguagePicker() {
  const { locale, setLocale, t } = useI18n()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Keeps the menu inside the screen, flipping it
  // above the trigger when there is no room below.
  const menuStyle = useDropdownPosition(open, ref, menuRef)

  return (
    <div className="language-picker" ref={ref}>
      <button
        type="button"
        className="language-picker-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={t('nav.language')}
        title={t('nav.language')}
      >
        <span aria-hidden="true">🌐</span>
        <span className="language-picker-current">{SHORT[locale]}</span>
      </button>

      {open && (
        <div
          className="language-picker-menu"
          role="menu"
          ref={menuRef}
          style={menuStyle}
        >
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="menuitemradio"
              aria-checked={locale === code}
              className={`language-picker-option ${locale === code ? 'is-active' : ''}`}
              onClick={() => {
                setLocale(code)
                setOpen(false)
              }}
            >
              <span className="language-picker-code">{SHORT[code]}</span>
              <span className="language-picker-name">{LOCALE_NAMES[code]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}