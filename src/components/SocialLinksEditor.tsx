import { useState, useRef, useEffect } from 'react'
import type { SocialLink, SocialPlatform } from '../types'
import { SOCIAL_PLATFORM_ORDER, SOCIAL_PLATFORM_SPECS, socialLinkName } from '../utils/socialPlatforms'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import './SocialLinksEditor.css'
import { useI18n } from '../i18n'

interface SocialLinksEditorProps {
  links: SocialLink[]
  onChange: (links: SocialLink[]) => void
}

/**
 * Adds social links through an "Add" menu offering the supported networks.
 * Each network takes the handle in its own format, and custom links ask for a
 * name. Links are stored already built, so what is shown is what is saved.
 */
export default function SocialLinksEditor({ links, onChange }: SocialLinksEditorProps) {
  const { t } = useI18n()
  const [menuOpen, setMenuOpen] = useState(false)
  const [picked, setPicked] = useState<SocialPlatform | null>(null)
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const platformMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const spec = picked ? SOCIAL_PLATFORM_SPECS[picked] : null
  const preview = picked ? spec!.build(value) : null
  const canAdd = Boolean(preview) && (!spec!.needsLabel || label.trim().length > 0)

  const reset = () => {
    setPicked(null)
    setValue('')
    setLabel('')
  }

  const add = () => {
    if (!picked || !preview) return
    const next: SocialLink = {
      platform: picked,
      url: preview,
      ...(picked === 'custom' ? { label: label.trim() } : {}),
    }
    onChange([...links, next])
    reset()
    setMenuOpen(false)
  }

  const removeAt = (index: number) => onChange(links.filter((_, i) => i !== index))

  // Keeps the network menu inside the screen, flipping it
  // above the button when there is no room below.
  const platformMenuStyle = useDropdownPosition(
    menuOpen,
    anchorRef,
    platformMenuRef
  )

  return (
    <div className="social-links-editor">
      <ul className="social-links-list">
        {links.map((link, index) => {
          const linkSpec = SOCIAL_PLATFORM_SPECS[link.platform]
          return (
            <li key={`${link.platform}-${index}`} className="social-link-row">
              <span className="social-link-icon" aria-hidden="true">
                {linkSpec?.icon ?? '🔗'}
              </span>
              <span className="social-link-name">{socialLinkName(link)}</span>
              <a className="social-link-url" href={link.url} target="_blank" rel="noopener noreferrer">
                {link.url}
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => removeAt(index)}
                aria-label={t('social.removeLink', { name: socialLinkName(link) })}
              >
                {t('editor.remove')}
              </button>
            </li>
          )
        })}
        {links.length === 0 && (
          <li className="social-links-empty">{t('social.noLinks')}</li>
        )}
      </ul>

      <div className="social-links-add" ref={menuRef}>
        <div className="social-links-addmenu" ref={anchorRef}>
          <button
            type="button"
            className={`btn btn-secondary btn-sm ${menuOpen ? 'is-open' : ''}`}
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
          >
            {t('social.add')}
          </button>
          {menuOpen && !picked && (
            <div
              className="social-platform-menu"
              role="menu"
              ref={platformMenuRef}
              style={platformMenuStyle}
            >
              {SOCIAL_PLATFORM_ORDER.map((id) => {
                const s = SOCIAL_PLATFORM_SPECS[id]
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitem"
                    className="social-platform-option"
                    onClick={() => {
                      setPicked(id)
                      setValue('')
                      setLabel('')
                    }}
                  >
                    <span aria-hidden="true">{s.icon}</span>
                    {s.label}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {picked && spec && (
          <div className="social-link-form">
            <div className="social-link-form-head">
              <span className="social-link-form-title">
                <span aria-hidden="true">{spec.icon}</span> {spec.label}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={reset}>
                Cancel
              </button>
            </div>

            <label htmlFor="social-link-value">{t('social.linkHandle', { label: spec.label })}</label>
            <input
              id="social-link-value"
              value={value}
              autoFocus
              placeholder={spec.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canAdd && add()}
            />

            {spec.needsLabel && (
              <>
                <label htmlFor="social-link-label">{t('social.customName')}</label>
                <input
                  id="social-link-label"
                  value={label}
                  placeholder={t('social.customNamePlaceholder')}
                  onChange={(e) => setLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && canAdd && add()}
                />
              </>
            )}

            <p className="ae-hint">{spec.hint}</p>
            {value.trim() && (
              <p className="social-link-preview">
                {preview ? (
                  <>
                    Will save as <code>{preview}</code>
                  </>
                ) : (
                  <span className="social-link-preview-bad">
                    {t('social.invalid', { label: spec.label })}
                  </span>
                )}
              </p>
            )}

            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canAdd}
              onClick={add}
            >
              {t('social.addLink')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
