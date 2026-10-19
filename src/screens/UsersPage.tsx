import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { usersAPI, apiErrorMessage } from '../utils/api'
import { useI18n } from '../i18n'
import UserAvatar from '../components/UserAvatar'
import ContactMenu from '../components/ContactMenu'
import type { User } from '../types'
import './UsersPage.css'

type UsersSort = 'name' | 'phone' | 'contacts'

/**
 * The signed-in user's directory: the admin panel's user list
 * without the administrator tooling — no role configuration,
 * no tags, no tag search and no delete button.
 */
export default function UsersPage() {
  const { t } = useI18n()
  const { user } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<UsersSort>('name')

  useEffect(() => {
    let active = true
    usersAPI
      .getAll()
      .then((r) => {
        if (active) setUsers(r.data.users ?? [])
      })
      .catch((err) => {
        if (active) setError(apiErrorMessage(err, t('users.loadFailed')))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [t])

  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? users.filter(
          (u) =>
            u.name.toLowerCase().includes(q) ||
            (u.phone ?? '').toLowerCase().includes(q) ||
            (u.email ?? '').toLowerCase().includes(q) ||
            (u.socialLinks ?? []).some((l) => l.url.toLowerCase().includes(q))
        )
      : users

    const byName = (a: User, b: User) => a.name.localeCompare(b.name)
    return [...list].sort((a, b) => {
      if (sortBy === 'phone') {
        // Numbers before blanks, then alphabetical.
        const ap = a.phone ?? ''
        const bp = b.phone ?? ''
        if (!ap && bp) return 1
        if (ap && !bp) return -1
        return ap.localeCompare(bp, undefined, { numeric: true })
      }
      if (sortBy === 'contacts') {
        const ac = (a.socialLinks?.length ?? 0) + (a.phone ? 1 : 0)
        const bc = (b.socialLinks?.length ?? 0) + (b.phone ? 1 : 0)
        return bc - ac || byName(a, b)
      }
      return byName(a, b)
    })
  }, [users, query, sortBy])

  return (
    <div className="users-page">
      <h1>{t('nav.users')}</h1>

      {!user ? (
        <p className="users-login-required">{t('users.loginRequired')}</p>
      ) : loading ? (
        <div className="users-loading">
          <div className="spinner" />
          <p>{t('users.loading')}</p>
        </div>
      ) : error ? (
        <div className="users-error">
          <p>{error}</p>
        </div>
      ) : (
        <>
          <div className="users-search-panel">
            <div className="users-search-row">
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('users.searchPlaceholder')}
                aria-label={t('users.searchPlaceholder')}
              />
              <label className="users-sort">
                <span>{t('admin.sort')}</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as UsersSort)}
                  aria-label={t('admin.sort')}
                >
                  <option value="name">{t('admin.sortName')}</option>
                  <option value="phone">{t('admin.sortPhone')}</option>
                  <option value="contacts">{t('admin.sortContacts')}</option>
                </select>
              </label>
            </div>
          </div>

          <div className="users-table-wrap">
            <table className="users-table">
              <thead>
                <tr>
                  <th>{t('admin.name')}</th>
                  <th>{t('admin.phone')}</th>
                  <th>{t('admin.colContact')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="user-cell">
                        <UserAvatar name={u.name} avatar={u.avatar} size={32} />
                        <span>{u.name}</span>
                      </div>
                    </td>
                    <td>{u.phone || '—'}</td>
                    <td>
                      {u.email || (u.socialLinks?.length ?? 0) > 0 || u.phone ? (
                        <ContactMenu user={u} label={t('admin.colContact')} />
                      ) : (
                        <span className="users-muted">
                          {t('admin.noContactDetails')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleUsers.length === 0 && (
                  <tr>
                    <td colSpan={3} className="users-empty">
                      {t('users.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
