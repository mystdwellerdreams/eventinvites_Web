import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '../context/AuthContext'
import { adminAPI, usersAPI, eventsAPI, tagsAPI, chatsAPI, apiErrorMessage } from '../utils/api'
import { fetchRoles, hasRole } from '../utils/roles'
import { eventPhase } from '../utils/eventTime'
import type { Event, Invite, PasswordReset, Role, Tag, User, VisibilityMode } from '../types'
import TagCloud from '../components/TagCloud'
import EventRegistrationMenu from '../components/EventRegistrationMenu'
import UserAvatar from '../components/UserAvatar'
import ContactMenu from '../components/ContactMenu'
import InviteShare from '../components/InviteShare'
import BannersEditor from '../components/BannersEditor'
import ActivityLog from '../components/ActivityLog'
import BannerControlPanel from '../components/BannerControlPanel'
import SendMessageModal from '../components/SendMessageModal'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useCaptcha } from '../context/CaptchaContext'
import './AdminDashboard.css'
import { useI18n } from '../i18n'

type Tab = 'events' | 'users' | 'status' | 'tags' | 'banners'
type UsersSort = 'name' | 'phone' | 'contacts'

const TABS: Tab[] = ['events', 'users', 'status', 'tags', 'banners']

const USER_SUB_TABS: ('requests' | 'users' | 'invitations')[] = [
  'requests',
  'users',
  'invitations',
]

const isTab = (value: string | undefined): value is Tab =>
  !!value && (TABS as readonly string[]).includes(value)

const isUserSubTab = (
  value: string | undefined
): value is 'requests' | 'users' | 'invitations' =>
  !!value && (USER_SUB_TABS as readonly string[]).includes(value)

const isGuestRole = (role?: string): boolean => role === 'GUEST'

/** Registration links must point at whoever is actually running the app. */
const inviteBaseUrl = (): string =>
  typeof window !== 'undefined' ? window.location.origin : ''

/** Maps a visibility mode to its translation key. */
const VISIBILITY_LABEL_KEYS: Record<string, string> = {
  ALL: 'admin.visibilityAll',
  INCLUDE: 'admin.visibilityInclude',
  EXCLUDE: 'admin.visibilityExclude',
}

export default function AdminDashboard({
  initialTab,
  initialView,
}: {
  /** Tab named by a deep link, e.g. /admin?tab=users. */
  initialTab?: string
  /** Sub-tab of the Users tab, e.g. /admin?tab=users&view=requests. */
  initialView?: string
}) {
  const { t, locale } = useI18n()
  const { requireChallenge } = useCaptcha()
  const [stats, setStats] = useState({
    totalUsers: 0,
    totalEvents: 0,
    publishedEvents: 0,
    totalRegistrations: 0,
    totalTags: 0,
    restrictedEvents: 0,
  })
  const [events, setEvents] = useState<Event[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [tab, setTab] = useState<Tab>(isTab(initialTab) ? initialTab : 'status')
  // Tag management: a tag is picked from the cloud, then acted on by the menu.
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [panel, setPanel] = useState<null | 'add' | 'assign' | 'edit'>(null)
  const [newTagName, setNewTagName] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [busyTag, setBusyTag] = useState(false)
  const [tagError, setTagError] = useState('')
  // Tags tab: the Assign panel's user search.
  const [tagAssignQuery, setTagAssignQuery] = useState('')
  // Per-user tag menu in the Users tab.
  const [tagMenuUserId, setTagMenuUserId] = useState<string | null>(null)
  // Per-event quick actions in the Events table: the visibility
  // tag menu and the event whose publish state is being toggled.
  const [visibilityMenuEventId, setVisibilityMenuEventId] = useState<string | null>(null)
  const [busyEventId, setBusyEventId] = useState<string | null>(null)
  // The user an administrator is writing a message to.
  const [messageTarget, setMessageTarget] = useState<{ id: string; name: string } | null>(null)
  // The event whose registration menu is expanded in the table.
  const [registrationMenuEventId, setRegistrationMenuEventId] = useState<string | null>(null)
  // Users tab: search, sorting, and the tag-scoped mode.
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState<UsersSort>('name')
  const [searchByTags, setSearchByTags] = useState(false)
  // Users tab on phones: the filter menu above the user list.
  const [filterOpen, setFilterOpen] = useState(false)
  // The Users section's sub-tab: requests, the user list, or invitations.
  const [userSubTab, setUserSubTab] = useState<
    'requests' | 'users' | 'invitations'
  >(isUserSubTab(initialView) ? initialView : 'users')
  // Tag picked in the Users tab's cloud, distinct from the Tags tab selection.
  const [userFilterTagId, setUserFilterTagId] = useState<string | null>(null)
  // Guests awaiting approval.
  const [guests, setGuests] = useState<User[]>([])
  // Password reset requests awaiting an administrator.
  const [passwordResets, setPasswordResets] = useState<PasswordReset[]>([])
  // Invitations.
  const [invites, setInvites] = useState<Invite[]>([])
  const [latestInvite, setLatestInvite] = useState<Invite | null>(null)
  const [inviteNote, setInviteNote] = useState('')
  const [inviteMaxUses, setInviteMaxUses] = useState('0')
  const [busyInvite, setBusyInvite] = useState(false)
  // The reset request whose link was just copied.
  const [copiedResetId, setCopiedResetId] = useState<string | null>(null)
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const { user } = useAuth()
  // The mobile layout covers narrow screens and anything held
  // in portrait, as in the app shell's header panels.
  const isMobile = useMediaQuery('(orientation: portrait), (max-width: 640px)')

  const loadData = async () => {
    try {
      const [dashboardRes, eventsRes, usersRes, tagsRes, guestsRes, invitesRes, resetsRes] =
        await Promise.all([
          adminAPI.dashboard(),
          adminAPI.getEvents(),
          usersAPI.getAll(),
          tagsAPI.list(),
          adminAPI.guests(),
          adminAPI.invites(),
          adminAPI.passwordResets(),
        ])
      setStats(dashboardRes.data.stats)
      setEvents(eventsRes.data.events)
      setUsers(usersRes.data.users)
      setTags(tagsRes.data.tags)
      setGuests(guestsRes.data.guests)
      setInvites(invitesRes.data.invites)
      setPasswordResets(resetsRes.data.resets)
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.loadFailed')))
    }
  }

  useEffect(() => {
    loadData()
    fetchRoles().then(setRoles)
  }, [])

  // Deep links (?tab=…) switch the tab even when the
  // dashboard is already open.
  useEffect(() => {
    if (isTab(initialTab) && initialTab !== tab) {
      setTab(initialTab)
    }
  }, [initialTab, tab])

  // The Users tab's sub-tab is deep-linkable the same way
  // (?tab=users&view=requests), so the log can point straight at it.
  useEffect(() => {
    if (isUserSubTab(initialView) && initialView !== userSubTab) {
      setUserSubTab(initialView)
    }
  }, [initialView, userSubTab])

  /** Switches a tab and keeps the URL in sync for deep links. */
  const selectTab = (next: Tab) => {
    setTab(next)
    router.replace(`/admin?tab=${next}`, { scroll: false })
  }

  const handleRoleChange = async (target: User, role: string) => {
    try {
      await usersAPI.updateRole(target.id, role)
      await loadData()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.makeAdminFailed')))
    }
  }

  const handleDeleteUser = async (target: User) => {
    if (!window.confirm(`Delete ${target.name}? Their registrations are removed too.`)) return
    try {
      await usersAPI.remove(target.id)
      await loadData()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.deleteUserFailed')))
    }
  }

  const handleDeleteEvent = async (event: Event) => {
    if (!window.confirm(`Delete "${event.title}" and all of its registrations?`)) return
    // Deleting an event is irreversible, so a security check is asked for
    // over the whole screen before it goes ahead.
    requireChallenge('event-delete', async (token) => {
      try {
        await eventsAPI.remove(event.id, token)
        await loadData()
      } catch (err) {
        window.alert(apiErrorMessage(err, t('admin.deleteEventFailed')))
      }
    })
  }

  /** Toggles an event's published state, like the Publish button in the event settings. */
  const handleToggleEventPublished = async (event: Event) => {
    const next = !event.isPublished
    setEvents((list) => list.map((e) => (e.id === event.id ? { ...e, isPublished: next } : e)))
    setBusyEventId(event.id)
    try {
      await eventsAPI.update(event.id, { isPublished: next })
      await loadData()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('editor.publishFailed')))
      await loadData()
    } finally {
      setBusyEventId(null)
    }
  }

  /**
   * Saves one event's visibility from the table's tag menu. Like the
   * per-user tag menu, each change is applied straight away.
   */
  const handleEventVisibilityChange = async (
    event: Event,
    mode: VisibilityMode,
    tagIds: string[]
  ) => {
    setEvents((list) =>
      list.map((e) =>
        e.id === event.id
          ? {
              ...e,
              visibilityMode: mode,
              visibleTags: tagIds.map((id) => ({
                id,
                name: tags.find((x) => x.id === id)?.name ?? '',
              })),
            }
          : e
      )
    )
    try {
      await eventsAPI.update(event.id, { visibilityMode: mode, visibleTagIds: tagIds })
      await loadData()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.actionFailed')))
      await loadData()
    }
  }

  /** Applies a tag set to one user, rolling back the checkbox on failure. */
  const handleToggleUserTag = async (target: User, tagId: string) => {
    const current = target.tags ?? []
    const next = current.some((t) => t.id === tagId)
      ? current.filter((t) => t.id !== tagId)
      : [...current, { id: tagId, name: tags.find((t) => t.id === tagId)?.name ?? '' }]

    setUsers((list) => list.map((u) => (u.id === target.id ? { ...u, tags: next } : u)))
    try {
      await tagsAPI.setForUser(target.id, next.map((t) => t.id))
      await loadData()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.tagUpdateFailed')))
      await loadData()
    }
  }

  const selectedTag = tags.find((t) => t.id === selectedTagId) ?? null

  const selectTag = (tagId: string) => {
    setTagError('')
    setPendingDeleteId(null)
    if (tagId === selectedTagId) {
      // Clicking the selected tag again clears the selection.
      setSelectedTagId(null)
      setPanel(null)
      return
    }
    setSelectedTagId(tagId)
    const tag = tags.find((t) => t.id === tagId)
    setRenameValue(tag?.name ?? '')
  }

  const closePanels = () => {
    setPanel(null)
    setNewTagName('')
    setTagError('')
    setPendingDeleteId(null)
  }

  const runTagAction = async (action: () => Promise<void>) => {
    setBusyTag(true)
    setTagError('')
    try {
      await action()
    } catch (err) {
      setTagError(apiErrorMessage(err, t('admin.actionFailed')))
    } finally {
      setBusyTag(false)
    }
  }

  const handleAddTag = () => {
    const name = newTagName.trim()
    if (!name) return
    return runTagAction(async () => {
      const r = await tagsAPI.create(name)
      await loadData()
      setSelectedTagId(r.data.tag.id)
      setNewTagName('')
      setPanel(null)
    })
  }

  const handleRenameTag = () => {
    if (!selectedTagId) return
    const name = renameValue.trim()
    if (!name) return
    return runTagAction(async () => {
      await tagsAPI.rename(selectedTagId, name)
      await loadData()
      setPanel(null)
    })
  }

  /**
   * Two-step delete: the first press only arms the tag, the second removes it.
   * Any other interaction disarms.
   */
  const handleDeleteTag = () => {
    if (!selectedTagId) {
      setTagError('Select a tag from the cloud first.')
      return
    }
    if (pendingDeleteId !== selectedTagId) {
      setPendingDeleteId(selectedTagId)
      return
    }
    return runTagAction(async () => {
      await tagsAPI.remove(selectedTagId)
      await loadData()
      setSelectedTagId(null)
      setPendingDeleteId(null)
      setPanel(null)
    })
  }

  /** Assign or unassign the selected tag for one user. */
  const handleAssignSelectedTag = (target: User) => {
    if (!selectedTagId) return
    return handleToggleUserTag(target, selectedTagId)
  }

  const handleTagMenuToggle = (userId: string) => {
    setTagError('')
    setTagMenuUserId((current) => (current === userId ? null : userId))
  }

  /**
   * Filters and orders the Users tab.
   *
   * In tag mode the text box matches tag names and the cloud narrows to a
   * single tag; otherwise it matches name, phone, email and contact links.
   */
  const visibleUsers = useMemo(() => {
    const q = query.trim().toLowerCase()

    let list = users.filter((u) => {
      if (searchByTags) {
        if (userFilterTagId) {
          return (u.tags ?? []).some((t) => t.id === userFilterTagId)
        }
        if (!q) return true
        return (u.tags ?? []).some((t) => t.name.toLowerCase().includes(q))
      }
      if (!q) return true
      const phone = (u.phone ?? '').toLowerCase()
      return (
        u.name.toLowerCase().includes(q) ||
        phone.includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.socialLinks ?? []).some((l) => l.url.toLowerCase().includes(q))
      )
    })

    const byName = (a: User, b: User) => a.name.localeCompare(b.name)
    list = [...list].sort((a, b) => {
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

    return list
  }, [users, query, sortBy, searchByTags, userFilterTagId])

  /**
   * Users matching the Tags tab's Assign panel search bar.
   * Matches name, phone, email and contact links.
   */
  const assignSearchUsers = useMemo(() => {
    const q = tagAssignQuery.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => {
      const phone = (u.phone ?? '').toLowerCase()
      return (
        u.name.toLowerCase().includes(q) ||
        phone.includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.socialLinks ?? []).some((l) => l.url.toLowerCase().includes(q))
      )
    })
  }, [users, tagAssignQuery])

  const upcomingCount = useMemo(
    () => events.filter((e) => eventPhase(e) === 'upcoming').length,
    [events]
  )

  /**
   * Opens a feedback message's conversation, from the activity log's
   * feedback entries. The conversation is created on demand, so the
   * first answer also opens the sender's Messages section for them.
   */
  const openFeedbackChat = async (userId: string) => {
    try {
      const r = await chatsAPI.open({ userId, kind: 'SUPPORT' })
      router.push(`/messages?chat=${r.data.chat.id}`)
    } catch (err) {
      window.alert(apiErrorMessage(err, t('messages.newChatFailed')))
    }
  }

  const handleApproveGuest = async (guest: User) => {
    try {
      const r = await adminAPI.approveGuest(guest.id)
      window.alert(r.data.message ?? `${guest.name} approved`)
      await loadData()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.approveGuestFailed')))
    }
  }

  /** Declines a guest request by removing the guest account. */
  const handleCancelGuest = async (guest: User) => {
    if (
      !window.confirm(
        `Cancel ${guest.name}'s request? Their guest account will be removed.`
      )
    )
      return
    try {
      await usersAPI.remove(guest.id)
      await loadData()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.deleteUserFailed')))
    }
  }

  const handleCreateInvite = async () => {
    setBusyInvite(true)
    try {
      const r = await adminAPI.createInvite({
        note: inviteNote || undefined,
        maxUses: Number(inviteMaxUses) || 0,
      })
      setLatestInvite(r.data.invite as Invite)
      setInviteNote('')
      setInvites((list) => [r.data.invite as Invite, ...list])
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.createInviteFailed')))
    } finally {
      setBusyInvite(false)
    }
  }

  const handleRevokeInvite = async (invite: Invite) => {
    try {
      await adminAPI.revokeInvite(invite.id)
      setInvites((list) => list.map((i) => (i.id === invite.id ? { ...i, revoked: true } : i)))
      setLatestInvite((current) => (current?.id === invite.id ? { ...current, revoked: true } : current))
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.withdrawInviteFailed')))
    }
  }

  /** Withdraws a pending password reset request. */
  const handleCancelPasswordReset = async (reset: PasswordReset) => {
    if (
      !window.confirm(
        `Cancel the reset request for ${reset.user.name}? The link will stop working.`
      )
    )
      return
    try {
      await adminAPI.cancelPasswordReset(reset.id)
      setPasswordResets((list) => list.filter((r) => r.id !== reset.id))
    } catch (err) {
      window.alert(apiErrorMessage(err, t('admin.cancelResetFailed')))
    }
  }

  /** Copies a reset link so the administrator can hand it over. */
  const copyResetLink = async (reset: PasswordReset) => {
    const url = `${inviteBaseUrl()}/reset-password?token=${reset.token}`
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        throw new Error(t('share.unavailable'))
      }
      setCopiedResetId(reset.id)
      window.setTimeout(() => {
        setCopiedResetId((current) => (current === reset.id ? null : current))
      }, 2500)
    } catch {
      // Clipboard needs a secure context; the link stays
      // selected so it can be copied by hand.
    }
  }

  // Close the per-user and per-event menus on an outside click.
  useEffect(() => {
    if (!tagMenuUserId && !visibilityMenuEventId) return
    const onDocClick = (e: MouseEvent) => {
      const el = e.target as HTMLElement
      if (
        !el.closest('.tag-assign-menu') &&
        !el.closest('.event-visibility-menu') &&
        !el.closest('.event-visibility-panel')
      ) {
        setTagMenuUserId(null)
        setVisibilityMenuEventId(null)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [tagMenuUserId, visibilityMenuEventId])

  if (!user || !hasRole(user, 'ADMIN')) {
    return (
      <div className="admin-denied">
        <h2>{t('admin.accessDeniedTitle')}</h2>
        <p>{t('admin.accessDeniedBody')}</p>
      </div>
    )
  }

  const roleLabel = (key: string) => roles.find((r) => r.key === key)?.label || key

  // The sorting controls render either inline (wide screens) or
  // inside the filter menu (phones), so they live in one place.
  const sortControl = (
    <label className="users-sort">
      <span>{t('admin.sort')}</span>
      <select
        value={sortBy}
        onChange={(e) => setSortBy(e.target.value as UsersSort)}
        aria-label="Sort users"
      >
        <option value="name">{t('admin.sortName')}</option>
        <option value="phone">{t('admin.sortPhone')}</option>
        <option value="contacts">{t('admin.sortContacts')}</option>
      </select>
    </label>
  )

  const tagSearchToggle = (
    <label className="users-toggle">
      <input
        type="checkbox"
        checked={searchByTags}
        onChange={(e) => {
          setSearchByTags(e.target.checked)
          setQuery('')
        }}
      />
      Search by tags
    </label>
  )

  const tagCloudBlock = searchByTags && tags.length > 0 && (
    <div className="tag-cloud-wrap">
      <p className="users-tagcloud-hint">
        {query.trim()
          ? 'No tag matches that name.'
          : 'Pick a tag to show only the users who hold it.'}
      </p>
      <TagCloud
        tags={tags}
        selectedId={userFilterTagId}
        onSelect={(tagId) => {
          setUserFilterTagId((current) =>
            current === tagId ? null : tagId
          )
          setQuery('')
        }}
      />
    </div>
  )

  return (
    <div className="admin-dashboard">
      <h1>{t('admin.dashboard')}</h1>

      <div className="admin-tabs" role="tablist" aria-label={t('admin.dashboard')}>
        <button className={tab === 'events' ? 'active' : ''} onClick={() => selectTab('events')} type="button">
          <span className="tab-icon" aria-hidden="true">📅</span>
          <span className="tab-label">{t('admin.tabEvents')}</span>
        </button>
        <button className={tab === 'users' ? 'active' : ''} onClick={() => selectTab('users')} type="button">
          <span className="tab-icon" aria-hidden="true">👥</span>
          <span className="tab-label">{t('admin.tabUsers')}</span>
        </button>
        <button className={tab === 'status' ? 'active' : ''} onClick={() => selectTab('status')} type="button">
          <span className="tab-icon" aria-hidden="true">📊</span>
          <span className="tab-label">{t('admin.tabStatus')}</span>
        </button>
        <button className={tab === 'tags' ? 'active' : ''} onClick={() => selectTab('tags')} type="button">
          <span className="tab-icon" aria-hidden="true">🏷️</span>
          <span className="tab-label">{t('admin.tabTags')}</span>
        </button>
        <button className={tab === 'banners' ? 'active' : ''} onClick={() => selectTab('banners')} type="button">
          <span className="tab-icon" aria-hidden="true">🖼️</span>
          <span className="tab-label">{t('admin.tabBanners')}</span>
        </button>
      </div>

      {tab === 'events' && (
        <div className="admin-section">
          <div className="section-header">
            <h2>{t('admin.tabEvents')}</h2>
            <Link href="/admin/events/new" className="btn btn-primary btn-sm">
              {t('admin.newEvent')}
            </Link>
          </div>
          <div className="events-table">
            <table>
              <thead>
                <tr>
                  <th>{t('admin.colTitle')}</th>
                  <th>{t('admin.colDate')}</th>
                  <th>{t('admin.colStatus')}</th>
                  <th>{t('admin.visibility')}</th>
                  <th>{t('admin.statRegistrations')}</th>
                  <th>{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <Fragment key={event.id}>
                    <tr>
                    <td>
                      <Link href={`/events/${event.id}`} className="admin-event-link">
                        {event.title}
                      </Link>
                      <div className="admin-event-key">/events/key/{event.key}</div>
                    </td>
                    <td>{new Date(event.dateTime).toLocaleString(locale)}</td>
                    <td>
                      <span className={`badge ${event.isPublished ? 'badge-success' : 'badge-warning'}`}>
                        {event.isPublished ? t('admin.published') : t('admin.draft')}
                      </span>
                      <div className="admin-cell-actions">
                        <button
                          type="button"
                          className={`btn btn-sm ${event.isPublished ? 'btn-secondary' : 'btn-primary'}`}
                          onClick={() => handleToggleEventPublished(event)}
                          disabled={busyEventId === event.id}
                          aria-pressed={event.isPublished}
                          title={event.isPublished ? t('editor.unpublish') : t('editor.publish')}
                        >
                          {event.isPublished ? t('editor.unpublish') : t('editor.publish')}
                        </button>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          event.visibilityMode === 'ALL' ? 'badge-user' : 'badge-admin'
                        }`}
                      >
                        {t(VISIBILITY_LABEL_KEYS[event.visibilityMode ?? 'ALL'])}
                      </span>
                      {event.visibleTags && event.visibleTags.length > 0 && (
                        <div className="admin-tag-list">
                          {event.visibleTags.map((t) => (
                            <span key={t.id} className="admin-tag-chip">
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="event-visibility-menu">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setVisibilityMenuEventId((current) =>
                              current === event.id ? null : event.id
                            )
                            // Only one inline menu is open at a time.
                            setRegistrationMenuEventId(null)
                          }}
                          aria-expanded={visibilityMenuEventId === event.id}
                        >
                          {t('admin.edit')}
                          <span className="caret" aria-hidden="true">
                            ▾
                          </span>
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="admin-reg-cell">
                        <span className="admin-reg-count">
                          {event._count?.registrations || 0}
                        </span>
                        <button
                          type="button"
                          className={`btn btn-sm ${
                            registrationMenuEventId === event.id ? 'btn-secondary' : 'btn-ghost'
                          }`}
                          onClick={() => {
                            setRegistrationMenuEventId((current) =>
                              current === event.id ? null : event.id
                            )
                            // Only one inline menu is open at a time.
                            setVisibilityMenuEventId(null)
                          }}
                          aria-expanded={registrationMenuEventId === event.id}
                        >
                          {t('admin.statRegistrations')}
                        </button>
                      </div>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => router.push(`/admin/events/${event.id}/edit`)}
                        >
              {t('admin.edit')}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleDeleteEvent(event)}
                        >
              {t('admin.delete')}
                        </button>
                      </div>
                    </td>
                    </tr>
                    {visibilityMenuEventId === event.id && (
                      <tr className="inline-menu-row">
                        <td colSpan={6}>
                          <div className="event-visibility-panel">
                            <p className="tag-assign-popover-hint">
                              {t('editor.visibilityIntro')}
                            </p>
                            <div
                              className="tag-visibility-modes"
                              role="radiogroup"
                              aria-label={t('admin.visibility')}
                            >
                              {(
                                [
                                  [
                                    'ALL',
                                    t('editor.visibilityEveryone'),
                                    t('editor.visibilityEveryoneHelp'),
                                  ],
                                  [
                                    'INCLUDE',
                                    t('editor.visibilityInclude'),
                                    t('editor.visibilityIncludeHelp'),
                                  ],
                                  [
                                    'EXCLUDE',
                                    t('editor.visibilityExclude'),
                                    t('editor.visibilityExcludeHelp'),
                                  ],
                                ] as [VisibilityMode, string, string][]
                              ).map(([mode, label, help]) => (
                                <label
                                  key={mode}
                                  className={`tag-mode ${
                                    (event.visibilityMode ?? 'ALL') === mode ? 'is-active' : ''
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name={`visibility-${event.id}`}
                                    value={mode}
                                    checked={(event.visibilityMode ?? 'ALL') === mode}
                                    onChange={() =>
                                      handleEventVisibilityChange(
                                        event,
                                        mode,
                                        (event.visibleTags ?? []).map((x) => x.id)
                                      )
                                    }
                                  />
                                  <span className="tag-mode-text">
                                    <strong>{label}</strong>
                                    <span>{help}</span>
                                  </span>
                                </label>
                              ))}
                            </div>
                            {event.visibilityMode !== 'ALL' && (
                              <div className="tag-picker">
                                <TagCloud
                                  tags={tags}
                                  size="sm"
                                  activeIds={(event.visibleTags ?? []).map((x) => x.id)}
                                  onSelect={(tagId) => {
                                    const current = (event.visibleTags ?? []).map((x) => x.id)
                                    const next = current.includes(tagId)
                                      ? current.filter((i) => i !== tagId)
                                      : [...current, tagId]
                                    handleEventVisibilityChange(
                                      event,
                                      event.visibilityMode ?? 'INCLUDE',
                                      next
                                    )
                                  }}
                                  emptyHint="No tags exist yet. Create them on the Admin dashboard under Tags."
                                />
                                <p className="ae-hint">{t('editor.clickTagInclude')}</p>
                                {(event.visibleTags ?? []).length === 0 && (
                                  <p className="ae-hint ae-tag-warning">
                                    {event.visibilityMode === 'INCLUDE'
                                      ? 'No tags selected: this event is currently visible to nobody without an administrator role.'
                                      : 'No tags selected: this event is currently visible to everyone.'}
                                  </p>
                                )}
                              </div>
                            )}
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm tag-assign-close"
                              onClick={() => setVisibilityMenuEventId(null)}
                            >
                              Done
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                    {registrationMenuEventId === event.id && (
                      <tr className="inline-menu-row">
                        <td colSpan={6}>
                          <EventRegistrationMenu
                            event={event}
                            users={users}
                            onClose={() => setRegistrationMenuEventId(null)}
                            onRefresh={loadData}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'users' && (
        <div className="admin-section">
          <h2>{t('admin.tabUsers')}</h2>

          <div
            className="admin-subtabs"
            role="tablist"
            aria-label={t('admin.tabUsers')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={userSubTab === 'requests'}
              className={userSubTab === 'requests' ? 'active' : ''}
              onClick={() => setUserSubTab('requests')}
            >
              {t('admin.tabRequests')} ({guests.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={userSubTab === 'users'}
              className={userSubTab === 'users' ? 'active' : ''}
              onClick={() => setUserSubTab('users')}
            >
              {t('admin.tabUsers')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={userSubTab === 'invitations'}
              className={userSubTab === 'invitations' ? 'active' : ''}
              onClick={() => setUserSubTab('invitations')}
            >
              {t('admin.tabInvitations')}
            </button>
          </div>

          {userSubTab === 'requests' && (
            <div className="user-subtab-panel">
              {guests.length > 0 ? (
                <div className="guest-alert" role="status">
                  <div className="guest-alert-head">
                    <strong>
                      {guests.length} guest account
                      {guests.length === 1 ? '' : 's'} awaiting approval
                    </strong>
                  </div>
                  <ul className="guest-alert-list">
                    {guests.map((g) => (
                      <li key={g.id}>
                        <UserAvatar name={g.name} avatar={g.avatar} size={28} />
                        <span className="guest-alert-name">{g.name}</span>
                        <span className="guest-alert-phone">{g.phone || '—'}</span>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={() => handleApproveGuest(g)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleCancelGuest(g)}
                        >
                          Cancel
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="admin-muted">No requests awaiting approval.</p>
              )}
            </div>
          )}

          {userSubTab === 'users' && (
            <div className="user-subtab-panel">
              <div className="users-search-panel">
                <div className="users-search-row">
                  <input
                    type="search"
                    className="tag-assign-search"
                    placeholder={
                      searchByTags
                        ? 'Type a tag name to filter…'
                        : 'Search by name, phone, email or contact link'
                    }
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search users"
                  />
                  {isMobile ? (
                    <button
                      type="button"
                      className="users-filter-btn"
                      onClick={() => setFilterOpen((o) => !o)}
                      aria-expanded={filterOpen}
                      aria-label={t('admin.filter')}
                      title={t('admin.filter')}
                    >
                      <span aria-hidden="true">⚙️</span>
                    </button>
                  ) : (
                    sortControl
                  )}
                </div>

                {isMobile ? (
                  filterOpen && (
                    <div className="users-filter-menu">
                      {sortControl}
                      {tagSearchToggle}
                      {tagCloudBlock}
                    </div>
                  )
                ) : (
                  <>
                    {tagSearchToggle}
                    {tagCloudBlock}
                  </>
                )}
              </div>

              <div className="users-table">
            <table>
              <thead>
                <tr>
                  <th>{t('admin.name')}</th>
                  <th>{t('admin.phone')}</th>
                  <th>{t('admin.colContact')}</th>
                  <th>{t('admin.role')}</th>
                  <th>{t('admin.tags')}</th>
                  <th>{t('admin.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => (
                  <tr key={u.id} className={isGuestRole(u.role) ? 'is-guest' : ''}>
                    <td>
                      <div className="user-cell">
                        <UserAvatar name={u.name} avatar={u.avatar} size={32} />
                        <span>{u.name}</span>
                        {isGuestRole(u.role) && <span className="badge badge-guest">{t('admin.guestBadge')}</span>}
                      </div>
                    </td>
                    <td>{u.phone || '—'}</td>
                    <td>
                      {u.email || (u.socialLinks?.length ?? 0) > 0 || u.phone ? (
                        <ContactMenu user={u} label="Contact" />
                      ) : (
                        <span className="admin-muted">{t('admin.noContactDetails')}</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          isGuestRole(u.role)
                            ? 'badge-guest'
                            : hasRole(u, 'ADMIN')
                              ? 'badge-admin'
                              : 'badge-user'
                        }`}
                      >
                        {roleLabel(u.role)}
                      </span>
                    </td>
                    <td>
                      {tags.length === 0 ? (
                        <span className="admin-muted">{t('admin.noTagsDefined')}</span>
                      ) : (
                        <TagAssignMenu
                          user={u}
                          tags={tags}
                          open={tagMenuUserId === u.id}
                          onToggle={() => handleTagMenuToggle(u.id)}
                          onClose={() => setTagMenuUserId(null)}
                          onToggleTag={(tagId) => handleToggleUserTag(u, tagId)}
                        />
                      )}
                    </td>
                    <td>
                      {u.id === user.id ? (
                        <span className="admin-self-note">{t('admin.thatIsYou')}</span>
                      ) : (
                        <div className="action-buttons">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            title={t('notifications.sendTitle')}
                            aria-label={t('notifications.sendTitle')}
                            onClick={() => setMessageTarget({ id: u.id, name: u.name })}
                          >
                            <span aria-hidden="true">✉️</span>
                          </button>
                          <select
                            value={u.role}
                            onChange={(e) => handleRoleChange(u, e.target.value)}
                            aria-label={`Role for ${u.name}`}
                            className="admin-role-select"
                          >
                            {roles.map((role) => (
                              <option key={role.key} value={role.key}>
                                {role.label}
                              </option>
                            ))}
                          </select>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleDeleteUser(u)}
                          >
              {t('admin.delete')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleUsers.length === 0 && (
                  <tr>
                    <td colSpan={6} className="admin-muted admin-empty-row">
                      No users match that search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
            </div>
          )}

          {userSubTab === 'invitations' && (
            <div className="user-subtab-panel">
              <div className="users-invites">
                <h3>{t('admin.inviteUser')}</h3>
                <p className="admin-hint">
                  An invitation link signs the recipient up as a regular user straight away. Without
                  one, new accounts arrive as guests and wait for your approval.
                </p>
                <div className="users-invite-form">
                  <input
                    value={inviteNote}
                    onChange={(e) => setInviteNote(e.target.value)}
                    placeholder="Optional note, e.g. Autumn gala guest list"
                    aria-label="Invitation note"
                  />
                  <input
                    type="number"
                    min="0"
                    value={inviteMaxUses}
                    onChange={(e) => setInviteMaxUses(e.target.value)}
                    placeholder="Max uses (0 = unlimited)"
                    aria-label="Maximum uses"
                    className="users-invite-narrow"
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyInvite}
                    onClick={handleCreateInvite}
                  >
                    {busyInvite ? 'Creating...' : 'Create link'}
                  </button>
                </div>

                {latestInvite && (
                  <div className="users-invite-latest">
                    <InviteShare url={`${inviteBaseUrl()}/register?invite=${latestInvite.token}`} />
                    {latestInvite.expiresAt && (
                      <p className="admin-hint">
                        Expires {new Date(latestInvite.expiresAt).toLocaleDateString(locale)}.
                      </p>
                    )}
                  </div>
                )}

                {invites.length > 0 && (
                  <ul className="users-invite-list">
                    {invites.map((inv) => (
                      <li key={inv.id} className={inv.revoked ? 'is-revoked' : ''}>
                        <span className="users-invite-token">{inv.token}</span>
                        <span className="users-invite-meta">
                          {inv.maxUses > 0 ? `${inv.uses}/${inv.maxUses} used` : `${inv.uses} used`}
                          {inv.note ? ` · ${inv.note}` : ''}
                        </span>
                        {inv.revoked ? (
                          <span className="badge badge-guest">{t('admin.withdrawn')}</span>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => handleRevokeInvite(inv)}
                          >
                            Withdraw
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'status' && (
        <div className="admin-section">
          <h2>{t('admin.tabStatus')}</h2>
          <div className="stats-grid stats-grid--pair">
            <button
              type="button"
              className="stat-card stat-card--link"
              onClick={() => {
                setUserSubTab('requests')
                selectTab('users')
              }}
            >
              <span className="stat-value">
                {stats.totalUsers}
                <span className="stat-detail">({guests.length})</span>
              </span>
              <span className="stat-label">{t('admin.statUsers')}</span>
              <span className="stat-sub">{t('admin.tabRequests')}</span>
            </button>
            <button
              type="button"
              className="stat-card stat-card--link"
              onClick={() => selectTab('events')}
            >
              <span className="stat-value">
                {stats.totalEvents}
                <span className="stat-detail">({upcomingCount})</span>
              </span>
              <span className="stat-label">{t('admin.statEvents')}</span>
              <span className="stat-sub">{t('admin.statUpcoming')}</span>
            </button>
          </div>

          <div className="reset-requests">
            <h3>{t('admin.resetRequests')}</h3>
            <p className="admin-hint">{t('admin.resetRequestsHint')}</p>
            {passwordResets.length === 0 ? (
              <p className="admin-muted">{t('admin.noResetRequests')}</p>
            ) : (
              <ul className="reset-request-list">
                {passwordResets.map((reset) => (
                  <li key={reset.id} className="reset-request">
                    <div className="reset-request-head">
                      <UserAvatar name={reset.user.name} avatar={null} size={28} />
                      <span className="reset-request-name">{reset.user.name}</span>
                      <span className="reset-request-phone">
                        {reset.user.phone || '—'}
                      </span>
                      <span className="reset-request-time">
                        {new Date(reset.createdAt).toLocaleString(locale)}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleCancelPasswordReset(reset)}
                      >
                        {t('admin.cancelReset')}
                      </button>
                    </div>
                    <div className="reset-link-row">
                      <input
                        readOnly
                        value={`${inviteBaseUrl()}/reset-password?token=${reset.token}`}
                        className="invite-share-url"
                        aria-label={t('share.urlLabel')}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => copyResetLink(reset)}
                      >
                        {copiedResetId === reset.id
                          ? t('share.copied')
                          : t('share.copy')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Counter and poll banners on the home page, when present. */}
          <BannerControlPanel />

          {/* Every action worth knowing about, newest first. */}
          <ActivityLog
            onReplyToFeedback={(id, name) => setMessageTarget({ id, name })}
            onOpenFeedbackChat={openFeedbackChat}
          />
        </div>
      )}
      {tab === 'tags' && (
        <div className="admin-section">
          <h2>{t('admin.tabTags')}</h2>
          <p className="admin-hint">
            Tags categorise users and drive event visibility. They are never shown to
            regular users. Pick a tag from the cloud, then use the menu to manage it.
          </p>

          <div className="tag-menu" role="toolbar" aria-label="Tag actions">
            <button
              type="button"
              className={`btn btn-sm ${panel === 'add' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setPanel(panel === 'add' ? null : 'add')}
              disabled={busyTag}
            >
              Add
            </button>
            <button
              type="button"
              className={`btn btn-sm ${panel === 'assign' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                setPanel(panel === 'assign' ? null : 'assign')
                setTagError('')
                if (!selectedTagId) setTagError('Select a tag from the cloud first.')
              }}
              disabled={busyTag}
            >
              Assign
            </button>
            <button
              type="button"
              className={`btn btn-sm ${panel === 'edit' ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => {
                setPanel(panel === 'edit' ? null : 'edit')
                setTagError('')
                if (!selectedTagId) {
                  setTagError('Select a tag from the cloud first.')
                } else {
                  setRenameValue(selectedTag?.name ?? '')
                }
              }}
              disabled={busyTag || !selectedTagId}
            >
              {t('admin.edit')}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${pendingDeleteId ? 'btn-danger' : 'btn-secondary'}`}
              onClick={handleDeleteTag}
              disabled={busyTag || !selectedTagId}
            >
              {/* Only prompt for confirmation once a real delete is armed.
                  Comparing the two ids directly would be true when both are
                  null, which is the idle state. */}
              {pendingDeleteId && pendingDeleteId === selectedTagId
                ? t('admin.tagDeleteConfirm')
                : t('admin.tagDelete')}
            </button>

            {selectedTag && (
              <span className="tag-menu-selection">
                Selected: <strong>{selectedTag.name}</strong>
              </span>
            )}
          </div>

          {tagError && <p className="tag-error">{tagError}</p>}

          {panel === 'add' && (
            <div className="tag-panel">
              <label htmlFor="new-tag-name">{t('admin.tagNewName')}</label>
              <div className="tag-panel-row">
                <input
                  id="new-tag-name"
                  value={newTagName}
                  autoFocus
                  onChange={(e) => setNewTagName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                  placeholder="e.g. Alumni"
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyTag || !newTagName.trim()}
                  onClick={handleAddTag}
                >
                  Create
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={closePanels}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="tag-cloud-wrap">
            <TagCloud
              tags={tags}
              selectedId={selectedTagId}
              pendingDeleteId={pendingDeleteId}
              onSelect={selectTag}
            />
          </div>

          {panel === 'edit' && selectedTag && (
            <div className="tag-panel">
              <label htmlFor="rename-tag">Rename “{selectedTag.name}”</label>
              <div className="tag-panel-row">
                <input
                  id="rename-tag"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleRenameTag()}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyTag || !renameValue.trim() || renameValue.trim() === selectedTag.name}
                  onClick={handleRenameTag}
                >
                  Save
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={closePanels}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {panel === 'assign' && selectedTag && (
            <div className="tag-panel">
              <h3 className="tag-panel-title">
                Assign “{selectedTag.name}” to users
              </h3>
              {users.length === 0 ? (
                <p className="admin-muted">{t('admin.tagNoUsers')}</p>
              ) : (
                <>
                  <input
                    type="search"
                    className="tag-assign-search"
                    placeholder={t('admin.tagAssignSearch')}
                    value={tagAssignQuery}
                    onChange={(e) => setTagAssignQuery(e.target.value)}
                    aria-label={t('admin.tagAssignSearch')}
                  />
                  {assignSearchUsers.length === 0 ? (
                    <p className="admin-muted">{t('admin.tagNoMatch')}</p>
                  ) : (
                    <ul className="tag-assign-list">
                      {assignSearchUsers.map((u) => {
                        const held = (u.tags ?? []).some((t) => t.id === selectedTagId)
                        return (
                          <li key={u.id} className="tag-assign-row">
                            <UserAvatar name={u.name} avatar={u.avatar} size={28} />
                            <span className="tag-assign-name">{u.name}</span>
                            {u.email && (
                              <span className="tag-assign-email">{u.email}</span>
                            )}
                            <button
                              type="button"
                              className={`btn btn-sm ${
                                held ? 'btn-secondary' : 'btn-primary'
                              }`}
                              disabled={busyTag}
                              onClick={() => handleAssignSelectedTag(u)}
                            >
                              {held ? 'Unassign' : 'Assign'}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'banners' && <BannersEditor />}

      {/* The administrator's message to one user, opened from the users tab
          or from a feedback reply. */}
      {messageTarget && (
        <SendMessageModal
          userId={messageTarget.id}
          userName={messageTarget.name}
          onClose={() => setMessageTarget(null)}
        />
      )}
    </div>
  )
}

/**
 * The tag control on a user row: a button showing the
 * user's tags that opens a popover with the tag cloud.
 */
function TagAssignMenu({
  user,
  tags,
  open,
  onToggle,
  onClose,
  onToggleTag,
}: {
  user: User
  tags: Tag[]
  open: boolean
  onToggle: () => void
  onClose: () => void
  onToggleTag: (tagId: string) => void
}) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Keeps the popover inside the screen, flipping it
  // above the button when there is no room below.
  const menuStyle = useDropdownPosition(open, anchorRef, menuRef)

  return (
    <div className="tag-assign-menu" ref={anchorRef}>
      <button
        type="button"
        className={`btn btn-sm ${
          (user.tags ?? []).length > 0 ? 'btn-secondary' : 'btn-ghost'
        }`}
        onClick={onToggle}
        aria-expanded={open}
      >
        {(user.tags ?? []).length > 0 ? (
          <>
            {(user.tags ?? []).map((t) => t.name).join(', ')}
            <span className="caret" aria-hidden="true">
              ▾
            </span>
          </>
        ) : (
          <>
            Assign tags<span className="caret" aria-hidden="true">▾</span>
          </>
        )}
      </button>
      {open && (
        <div
          className="tag-assign-popover"
          ref={menuRef}
          style={menuStyle}
        >
          <p className="tag-assign-popover-hint">
            Click a tag to assign or remove it from {user.name}.
          </p>
          <TagCloud
            tags={tags}
            size="sm"
            activeIds={(user.tags ?? []).map((t) => t.id)}
            onSelect={onToggleTag}
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm tag-assign-close"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}

