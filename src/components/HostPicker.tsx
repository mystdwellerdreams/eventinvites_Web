import { useMemo, useRef, useState, useEffect } from 'react'
import type { User } from '../types'
import UserAvatar from './UserAvatar'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import './HostPicker.css'
import { useI18n } from '../i18n'

interface HostPickerProps {
  users: User[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  label?: string
}

/**
 * A searchable list for choosing one or more hosts. Replaces a native
 * `<select>`, which cannot express multi-select or search.
 */
export default function HostPicker({
  users,
  selectedIds,
  onChange,
  label = 'host.hostsLabel',
}: HostPickerProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
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

  const selected = useMemo(
    () => users.filter((u) => selectedIds.includes(u.id)),
    [users, selectedIds]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pool = users.filter((u) => !selectedIds.includes(u.id))
    if (!q) return pool
    return pool.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.phone ?? '').toLowerCase().includes(q)
    )
  }, [users, query, selectedIds])

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    )
  }

  // Keeps the menu inside the screen, flipping it
  // above the trigger when there is no room below.
  const menuStyle = useDropdownPosition(open, ref, menuRef)

  return (
    <div className="host-picker" ref={ref}>
      <label className="host-picker-label">
        {t(label)}
        {selected.length > 0 && <span className="host-picker-count">{t('host.selected', { count: selected.length })}</span>}
      </label>

      {selected.length > 0 && (
        <ul className="host-picker-chosen">
          {selected.map((u) => (
            <li key={u.id} className="host-picker-chip">
              <UserAvatar name={u.name} avatar={u.avatar} size={22} />
              <span>{u.name}</span>
              <button
                type="button"
                className="host-picker-remove"
                onClick={() => toggle(u.id)}
                aria-label={t('host.remove', { name: u.name })}
                title={t('host.remove', { name: u.name })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={t('host.search')}
        aria-label={t('host.searchLabel', { label: t(label) })}
      />

      {open && (
        <div
          className="host-picker-menu"
          role="listbox"
          aria-multiselectable="true"
          ref={menuRef}
          style={menuStyle}
        >
          {filtered.length === 0 ? (
            <p className="host-picker-empty">
              {users.length === 0
                ? t('host.noneAvailable')
                : selected.length === users.length
                  ? t('host.allChosen')
                  : t('host.noMatch')}
            </p>
          ) : (
            <ul>
              {filtered.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className="host-picker-option"
                    role="option"
                    aria-selected={false}
                    onClick={() => toggle(u.id)}
                  >
                    <UserAvatar name={u.name} avatar={u.avatar} size={28} />
                    <span className="host-picker-option-text">
                      <span className="host-picker-option-name">{u.name}</span>
                      <span className="host-picker-option-meta">
                        {u.email || u.phone || '—'}
                      </span>
                    </span>
                    <span className="host-picker-option-add" aria-hidden="true">
                      {t('host.add')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

