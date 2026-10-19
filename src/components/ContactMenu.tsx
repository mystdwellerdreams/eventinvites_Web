import { useState, useRef, useEffect } from 'react'
import type { User } from '../types'
import { SOCIAL_PLATFORM_SPECS, socialLinkName } from '../utils/socialPlatforms'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import './ContactMenu.css'
import { useI18n } from '../i18n'

interface ContactMenuProps {
  user: User
  /** Text on the trigger button. */
  label?: string
}

export default function ContactMenu({ user, label = 'contact.menu' }: ContactMenuProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
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

  const socials = user.socialLinks ?? []
  const hasOptions = Boolean(user.phone) || socials.length > 0

  // Keeps the dropdown inside the screen, flipping it
  // above the trigger when there is no room below.
  const menuStyle = useDropdownPosition(open, ref, menuRef)

  if (!hasOptions) return null

  return (
    <div className="contact-menu" ref={ref}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {t(label)} ▾
      </button>
      {open && (
        <div
          className="contact-menu-dropdown"
          role="menu"
          ref={menuRef}
          style={menuStyle}
        >
          {user.phone && (
            <a href={`tel:${user.phone}`} className="contact-menu-item" role="menuitem">
              <span className="contact-menu-icon">📞</span>
              <span className="contact-menu-text">
                <strong>{t('contact.call')}</strong>
                <em>{user.phone}</em>
              </span>
            </a>
          )}
          {socials.map((link, i) => (
            <a
              key={`${link.platform}-${i}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="contact-menu-item"
              role="menuitem"
            >
              <span className="contact-menu-icon" aria-hidden="true">
                {SOCIAL_PLATFORM_SPECS[link.platform]?.icon ?? '🔗'}
              </span>
              <span className="contact-menu-text">
                <strong>{socialLinkName(link)}</strong>
                <em>{link.url}</em>
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
