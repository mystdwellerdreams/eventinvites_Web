import { useEffect, useMemo, useRef, useState } from 'react'
import { adminAPI, eventsAPI, apiErrorMessage } from '../utils/api'
import type { Event, ParticipantList, Registration, User } from '../types'
import ContactMenu from './ContactMenu'
import UserAvatar from './UserAvatar'
import NotifyParticipantsModal from './NotifyParticipantsModal'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import './EventRegistrationMenu.css'
import { useI18n } from '../i18n'

interface EventRegistrationMenuProps {
  event: Event
  /** Every user, for the Assign view's master list. */
  users: User[]
  /** Closes the menu, when it sits in a dismissible surface. */
  onClose?: () => void
  /** Refreshes the surrounding data after a change. */
  onRefresh?: () => void
}

/**
 * The registration menu for one event, expanded inline in the
 * events table. Participant lists can be added, renamed and
 * deleted, and users can be moved between the lists, removed
 * from the event or assigned to it.
 */
export default function EventRegistrationMenu({
  event,
  users,
  onClose,
  onRefresh,
}: EventRegistrationMenuProps) {
  const { t } = useI18n()
  const [lists, setLists] = useState<ParticipantList[]>([])
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [view, setView] = useState<'lists' | 'assign'>('lists')
  const [assignQuery, setAssignQuery] = useState('')
  const [addListOpen, setAddListOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  // Two-step deletes: the first click arms, the second removes.
  const [armedListId, setArmedListId] = useState<string | null>(null)
  const [armedRegId, setArmedRegId] = useState<string | null>(null)
  // The user whose move-to-list menu is open.
  const [moveRegId, setMoveRegId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState('')
  const [error, setError] = useState('')
  // The organizer's update to the participants.
  const [notifyOpen, setNotifyOpen] = useState(false)

  const load = async () => {
    try {
      const r = await adminAPI.getEventRegistrations(event.id)
      const loaded = (r.data.event.lists ?? []) as ParticipantList[]
      setLists(loaded)
      setSelectedListId((current) =>
        current && loaded.some((l) => l.id === current)
          ? current
          : (loaded.find((l) => l.isDefault)?.id ?? loaded[0]?.id ?? null)
      )
      setError('')
    } catch (err) {
      setError(apiErrorMessage(err, t('reg.loadFailed')))
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event.id])

  // Close the move-to-list menu on an outside click.
  useEffect(() => {
    if (!moveRegId) return
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (!el.closest('.reg-menu-move')) {
        setMoveRegId(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [moveRegId])

  const selectedList = lists.find((l) => l.id === selectedListId) ?? null

  /** The total number of users registered for the event. */
  const totalRegistrations = lists.reduce(
    (sum, l) => sum + (l.registrations?.length || 0),
    0
  )

  /** Registrations indexed by user id, for the Assign view. */
  const registrationsByUser = useMemo(() => {
    const map = new Map<string, Registration>()
    for (const list of lists) {
      for (const reg of list.registrations ?? []) {
        map.set(reg.user.id, reg)
      }
    }
    return map
  }, [lists])

  /**
   * The master user list, narrowed by the Assign view's search
   * bar. Guests are left out: they cannot register until an
   * administrator approves them.
   */
  const assignableUsers = useMemo(() => {
    const q = assignQuery.trim().toLowerCase()
    return users
      .filter(
        (u) =>
          u.role !== 'GUEST' &&
          (!q ||
            u.name.toLowerCase().includes(q) ||
            (u.phone ?? '').toLowerCase().includes(q) ||
            (u.email ?? '').toLowerCase().includes(q))
      )
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [users, assignQuery])

  /** Runs a mutation, then refreshes the menu and the dashboard. */
  const run = async (id: string, action: () => Promise<unknown>, fallback: string) => {
    setBusyId(id)
    setError('')
    // Disarm any two-step delete the mutation may interrupt.
    setArmedListId(null)
    setArmedRegId(null)
    try {
      await action()
      await load()
      onRefresh?.()
    } catch (err) {
      setError(apiErrorMessage(err, fallback))
    } finally {
      setBusyId('')
    }
  }

  const handleAddList = () => {
    const name = newListName.trim()
    if (!name) return
    return run(
      'add-list',
      async () => {
        await eventsAPI.createList(event.id, name)
        setAddListOpen(false)
        setNewListName('')
      },
      t('reg.addListFailed')
    )
  }

  const handleRenameList = () => {
    const name = renameValue.trim()
    if (!selectedListId || !name || name === selectedList?.name) {
      setRenameOpen(false)
      return
    }
    return run(
      selectedListId,
      async () => {
        await eventsAPI.updateList(event.id, selectedListId, { name })
        setRenameOpen(false)
      },
      t('reg.renameListFailed')
    )
  }

  const handleDeleteList = (list: ParticipantList) => {
    if (armedListId !== list.id) {
      setArmedListId(list.id)
      return
    }
    return run(
      list.id,
      async () => {
        await eventsAPI.deleteList(event.id, list.id)
      },
      t('reg.deleteListFailed')
    )
  }

  /** Makes the selected list the one new registrations join. */
  const handleMakeDefault = (list: ParticipantList) => {
    if (list.isDefault) return
    return run(
      list.id,
      async () => {
        await eventsAPI.updateList(event.id, list.id, { isDefault: true })
      },
      t('reg.makeDefaultFailed')
    )
  }

  const handleMove = (reg: Registration, listId: string) => {
    if (!listId || listId === reg.listId) {
      setMoveRegId(null)
      return
    }
    return run(
      reg.id,
      async () => {
        await eventsAPI.updateRegistration(event.id, reg.id, { listId })
        setMoveRegId(null)
      },
      t('reg.moveFailed')
    )
  }

  const handleRemoveRegistration = (reg: Registration) => {
    if (armedRegId !== reg.id) {
      setArmedRegId(reg.id)
      return
    }
    return run(
      reg.id,
      async () => {
        await adminAPI.removeRegistration(reg.id)
      },
      t('reg.removeFailed')
    )
  }

  /** Checking assigns the user to the selected list; unchecking removes them. */
  const handleAssignToggle = (user: User) => {
    const reg = registrationsByUser.get(user.id)
    if (reg) {
      return run(
        reg.id,
        async () => {
          await adminAPI.removeRegistration(reg.id)
        },
        t('reg.removeFailed')
      )
    }
    const listId = selectedListId ?? lists[0]?.id
    if (!listId) return
    return run(
      user.id,
      async () => {
        await adminAPI.createRegistration(event.id, user.id, listId)
      },
      t('reg.assignFailed')
    )
  }

  const openAddList = () => {
    setAddListOpen((open) => !open)
    setRenameOpen(false)
    setNewListName('')
  }

  const openRename = () => {
    if (!selectedList) return
    setRenameOpen((open) => !open)
    setAddListOpen(false)
    setRenameValue(selectedList.name)
  }

  return (
    <div className="reg-menu">
      <div className="reg-menu-head">
        <h3>{t('reg.title', { title: event.title })}</h3>
        <span className="reg-menu-total">
          {t('reg.registeredCount', { count: totalRegistrations })}
        </span>
        {onClose && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label={t('reg.close')}
          >
            ✕
          </button>
        )}
      </div>

      <div className="reg-menu-toolbar" role="toolbar" aria-label={t('reg.actions')}>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => setNotifyOpen(true)}
        >
          {t('reg.notifyParticipants')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${addListOpen ? 'btn-primary' : 'btn-secondary'}`}
          onClick={openAddList}
          disabled={busyId === 'add-list'}
        >
          {t('reg.addList')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${renameOpen ? 'btn-primary' : 'btn-secondary'}`}
          onClick={openRename}
          disabled={!selectedList || busyId === selectedListId}
        >
          {t('reg.rename')}
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => selectedList && handleMakeDefault(selectedList)}
          disabled={!selectedList || selectedList.isDefault || busyId === selectedListId}
        >
          {t('reg.makeDefault')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${view === 'assign' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setView(view === 'assign' ? 'lists' : 'assign')}
        >
          {t('reg.assign')}
        </button>
        <button
          type="button"
          className={`btn btn-sm ${
            armedListId === selectedListId ? 'btn-danger' : 'btn-secondary'
          }`}
          onClick={() => selectedList && handleDeleteList(selectedList)}
          disabled={!selectedList || busyId === selectedListId}
        >
          {armedListId === selectedListId ? t('reg.deleteConfirm') : t('admin.delete')}
        </button>
      </div>

      {addListOpen && (
        <div className="reg-menu-field">
          <input
            value={newListName}
            autoFocus
            onChange={(e) => setNewListName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddList()}
            placeholder={t('reg.newListName')}
            aria-label={t('reg.newListName')}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleAddList}
            disabled={!newListName.trim() || busyId === 'add-list'}
          >
            Save
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setAddListOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {renameOpen && selectedList && (
        <div className="reg-menu-field">
          <input
            value={renameValue}
            autoFocus
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRenameList()}
            placeholder={t('reg.renameList', { name: selectedList.name })}
            aria-label={t('reg.renameList', { name: selectedList.name })}
          />
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleRenameList}
            disabled={!renameValue.trim() || busyId === selectedListId}
          >
            Save
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setRenameOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="reg-menu-error" role="alert">
          {error}
        </p>
      )}

      {view === 'assign' ? (
        <div className="reg-menu-assign">
          <input
            type="search"
            className="reg-menu-search"
            value={assignQuery}
            onChange={(e) => setAssignQuery(e.target.value)}
            placeholder={t('reg.searchUsers')}
            aria-label={t('reg.searchUsers')}
          />
          <p className="reg-menu-assign-hint">
            {t('reg.assignHint')}{' '}
            {selectedList ? t('reg.assignTarget', { name: selectedList.name }) : ''}
          </p>
          {assignableUsers.length === 0 ? (
            <p className="reg-menu-empty">{t('reg.noUsers')}</p>
          ) : (
            <ul className="reg-menu-assign-list">
              {assignableUsers.map((u) => {
                const reg = registrationsByUser.get(u.id)
                return (
                  <li key={u.id} className="reg-menu-assign-row">
                    <label className="reg-menu-assign-check">
                      <input
                        type="checkbox"
                        checked={Boolean(reg)}
                        disabled={busyId === u.id || busyId === reg?.id}
                        onChange={() => handleAssignToggle(u)}
                      />
                      <UserAvatar name={u.name} avatar={u.avatar} size={28} />
                      <span className="reg-menu-user-name">{u.name}</span>
                      {reg && (
                        <span className="reg-menu-assign-list-name">
                          {lists.find((l) => l.id === reg.listId)?.name}
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div className="reg-menu-tabs" role="tablist" aria-label={t('reg.list')}>
            {lists.map((list) => (
              <button
                key={list.id}
                type="button"
                role="tab"
                aria-selected={list.id === selectedListId}
                className={`reg-menu-tab ${
                  list.id === selectedListId ? 'active' : ''
                } ${armedListId === list.id ? 'armed' : ''}`}
                onClick={() => {
                  setSelectedListId(list.id)
                  setArmedListId(null)
                  setMoveRegId(null)
                }}
              >
                {list.name}
                {list.isDefault && (
                  <span className="reg-menu-default">{t('reg.defaultList')}</span>
                )}
                <span className="reg-menu-tab-count">
                  {list.registrations?.length || 0}
                </span>
              </button>
            ))}
          </div>

          <div className="reg-menu-users">
            {selectedList && (selectedList.registrations?.length ?? 0) > 0 ? (
              <ul className="reg-menu-user-list">
                {selectedList.registrations!.map((reg) => (
                  <li
                    key={reg.id}
                    className={`reg-menu-user-row ${armedRegId === reg.id ? 'armed' : ''}`}
                  >
                    <div className="reg-menu-user-cell">
                      <UserAvatar name={reg.user.name} avatar={reg.user.avatar} size={32} />
                      <span className="reg-menu-user-name">{reg.user.name}</span>
                      {reg.user.phone && (
                        <span className="reg-menu-user-phone">{reg.user.phone}</span>
                      )}
                    </div>
                    <div className="reg-menu-user-actions">
                      {reg.user.phone || (reg.user.socialLinks?.length ?? 0) > 0 ? (
                        <ContactMenu user={reg.user} label="reg.contact" />
                      ) : (
                        <span className="admin-muted">{t('admin.noContactDetails')}</span>
                      )}
                      <div className="reg-menu-move">
                        <MoveToListMenu
                          reg={reg}
                          lists={lists}
                          busy={busyId === reg.id}
                          open={moveRegId === reg.id}
                          onToggle={() =>
                            setMoveRegId((current) =>
                              current === reg.id ? null : reg.id
                            )
                          }
                          onMove={(listId) => handleMove(reg, listId)}
                        />
                      </div>
                      <button
                        type="button"
                        className={`btn btn-sm ${
                          armedRegId === reg.id ? 'btn-danger' : 'btn-ghost'
                        }`}
                        onClick={() => handleRemoveRegistration(reg)}
                        disabled={busyId === reg.id}
                      >
                        {armedRegId === reg.id ? t('reg.deleteConfirm') : t('admin.delete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="reg-menu-empty">{t('reg.noRegistrations')}</p>
            )}
          </div>
        </>
      )}

      {notifyOpen && (
        <NotifyParticipantsModal
          eventId={event.id}
          onClose={() => setNotifyOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * The "Move" control on a participant row: a button that
 * opens a popover with the lists the participant can be
 * moved to.
 */
function MoveToListMenu({
  reg,
  lists,
  busy,
  open,
  onToggle,
  onMove,
}: {
  reg: Registration
  lists: ParticipantList[]
  busy: boolean
  open: boolean
  onToggle: () => void
  onMove: (listId: string) => void
}) {
  const { t } = useI18n()
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Keeps the popover inside the screen, flipping it
  // above the button when there is no room below.
  const menuStyle = useDropdownPosition(open, anchorRef, menuRef)

  return (
    <div className="reg-menu-move" ref={anchorRef}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {t('reg.move')}
        <span className="caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div
          className="reg-menu-move-popover"
          role="menu"
          ref={menuRef}
          style={menuStyle}
        >
          <p className="reg-menu-move-hint">
            {t('reg.moveHint', { name: reg.user.name })}
          </p>
          {lists
            .filter((l) => l.id !== reg.listId)
            .map((l) => (
              <button
                key={l.id}
                type="button"
                className="reg-menu-move-item"
                role="menuitem"
                disabled={busy}
                onClick={() => onMove(l.id)}
              >
                {l.name}
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
