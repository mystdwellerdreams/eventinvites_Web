import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { adminAPI, eventsAPI, apiErrorMessage } from '../utils/api'
import type { Event, Registration } from '../types'
import ContactMenu from '../components/ContactMenu'
import UserAvatar from '../components/UserAvatar'
import './AdminRegistrations.css'
import { useI18n } from '../i18n'

export default function AdminRegistrations() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [event, setEvent] = useState<Event | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  const loadEvent = useCallback(async () => {
    if (!id) return
    try {
      const response = await adminAPI.getEventRegistrations(id)
      setEvent(response.data.event)
      setError('')
    } catch (err) {
      setError(apiErrorMessage(err, t('reg.eventNotFound')))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadEvent()
  }, [loadEvent])

  const run = async (registrationId: string, action: () => Promise<unknown>, fallback: string) => {
    setBusyId(registrationId)
    try {
      await action()
      await loadEvent()
    } catch (err) {
      window.alert(apiErrorMessage(err, fallback))
    } finally {
      setBusyId('')
    }
  }

  const handleConfirm = (reg: Registration) =>
    run(
      reg.id,
      () => adminAPI.confirmRegistration(reg.id),
      'Failed to confirm participant'
    )

  const handleUnconfirm = (reg: Registration) =>
    run(reg.id, () => adminAPI.unconfirmRegistration(reg.id), 'Failed to unconfirm participant')

  const handleMove = (reg: Registration, listId: string) => {
    if (!event || !listId || listId === reg.listId) return
    return run(
      reg.id,
      () => eventsAPI.updateRegistration(event.id, reg.id, { listId }),
      'Failed to move participant'
    )
  }

  const handleRemove = (reg: Registration) => {
    if (!window.confirm(`Remove ${reg.user.name} from this event?`)) return
    return run(reg.id, () => adminAPI.removeRegistration(reg.id), 'Failed to remove registration')
  }

  if (loading) {
    return <div className="admin-reg-loading">{t('reg.loading')}</div>
  }

  if (!event) {
    return <div className="admin-reg-error">{error || 'Event not found'}</div>
  }

  const totalRegistrations = (event.lists || []).reduce(
    (sum, list) => sum + (list.registrations?.length || 0),
    0
  )

  return (
    <div className="admin-registrations">
      <div className="reg-header">
        <button className="btn btn-ghost btn-sm" onClick={() => router.push('/admin')}>
          ← Back
        </button>
        <h2>{event.title} — Registrations</h2>
        <span className="reg-total">{totalRegistrations} registered</span>
      </div>

      {(event.lists || []).map((list) => (
        <div key={list.id} className="reg-list-section">
          <h3>
            {list.name}
            {list.isDefault && <span className="ep-list-default">{t('reg.defaultList')}</span>}
            <span className="reg-count">{list.registrations?.length || 0}</span>
          </h3>
          {list.registrations && list.registrations.length > 0 ? (
            <table className="reg-table">
              <thead>
                <tr>
                  <th>{t('reg.participant')}</th>
                  <th>{t('reg.phone')}</th>
                  <th>{t('reg.contact')}</th>
                  <th>{t('reg.list')}</th>
                  <th>{t('reg.status')}</th>
                  <th>{t('reg.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {list.registrations.map((reg) => (
                  <tr key={reg.id} className={reg.status === 'CONFIRMED' ? 'confirmed-row' : ''}>
                    <td>
                      <div className="user-cell">
                        <UserAvatar name={reg.user.name} avatar={reg.user.avatar} size={32} />
                        <span>{reg.user.name}</span>
                      </div>
                    </td>
                    <td>{reg.user.phone || '—'}</td>
                    <td>
                      <ContactMenu user={reg.user} />
                    </td>
                    <td>
                      <select
                        className="reg-list-select"
                        value={reg.listId || list.id}
                        disabled={busyId === reg.id}
                        onChange={(e) => handleMove(reg, e.target.value)}
                        aria-label={t('reg.listFor', { name: reg.user.name })}
                      >
                        {(event.lists || []).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          reg.status === 'CONFIRMED' ? 'badge-success' : 'badge-warning'
                        }`}
                      >
                        {reg.status === 'CONFIRMED'
                          ? 'Confirmed'
                          : reg.status === 'WAITLIST'
                            ? 'Waitlisted'
                            : 'Pending'}
                      </span>
                    </td>
                    <td>
                      <div className="action-buttons">
                        {reg.status === 'CONFIRMED' ? (
                          <button
                            className="btn btn-secondary btn-sm"
                            disabled={busyId === reg.id}
                            onClick={() => handleUnconfirm(reg)}
                          >
                            Unconfirm
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busyId === reg.id}
                            onClick={() => handleConfirm(reg)}
                          >
                            Confirm
                          </button>
                        )}
                        <button
                          className="btn btn-danger btn-sm"
                          disabled={busyId === reg.id}
                          onClick={() => handleRemove(reg)}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-list">{t('reg.noRegistrations')}</p>
          )}
        </div>
      ))}
    </div>
  )
}

