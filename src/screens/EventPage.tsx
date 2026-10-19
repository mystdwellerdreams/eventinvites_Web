import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { useAuth } from '../context/AuthContext'
import { useAuthModal } from '../context/AuthModalContext'
import { eventsAPI, apiErrorMessage } from '../utils/api'
import { hasRole, isGuest } from '../utils/roles'
import { defaultLayout, sanitizeLayout } from '../utils/layout'
import {
  eventEndsAt,
  eventPhase,
  formatDuration,
  formatEventTimeRange,
  isEventLive,
  isRegistrationOpen,
} from '../utils/eventTime'
import { resolveBackTarget } from '../utils/backTarget'
import { takeNavigation, EVENT_DRAFT_KEY } from '../utils/navState'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import type { ElementType, Event, LayoutElement, Registration, User } from '../types'
import ContactMenu from '../components/ContactMenu'
import ShareMenu from '../components/ShareMenu'
import UserAvatar from '../components/UserAvatar'
import ImageCarousel from '../components/ImageCarousel'
import EventComments from '../components/EventComments'
import ToolboxNav from '../components/ToolboxNav'
import './EventPage.css'
import { useI18n } from '../i18n'

const DEFAULT_LAYOUT = defaultLayout()

/** Page sections whose text can be quoted into the discussion. */
const QUOTABLE_ELEMENTS = new Set<ElementType>([
  'description',
  'address',
  'host',
  'price',
  'contactInfo',
  'publicTags',
  'lists',
])

/** Shape of the unsaved event handed over by "View Page" while creating. */
export interface EventDraft {
  title: string
  shortDescription: string
  description: string
  dateTime: string
  durationMinutes: number | null
  endsAt: string | null
  unpublishAfterEnd: boolean
  address: string
  coverImage: string
  price: number | null
  contactInfo: string
  hostId: string
  pageStyle: Event['pageStyle']
  layout: LayoutElement[]
}

const isDraft = (value: unknown): value is EventDraft =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as EventDraft).dateTime === 'string' &&
  typeof (value as EventDraft).title === 'string'

export default function EventPage() {
  const { t, locale } = useI18n()
  const { id, key } = useParams<{ id?: string; key?: string }>()
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const [event, setEvent] = useState<Event | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [registering, setRegistering] = useState(false)
  const [busyRegId, setBusyRegId] = useState('')
  const [busyUnregister, setBusyUnregister] = useState(false)
  // The list picker in the action bar, and the armed
  // (highlighted) state of the two-step Unregister button.
  const [registerOpen, setRegisterOpen] = useState(false)
  const [unregisterArmed, setUnregisterArmed] = useState(false)
  const registerRef = useRef<HTMLDivElement>(null)
  const registerMenuRef = useRef<HTMLDivElement>(null)
  // Set when a page element's quote button is used; handed to the discussion
  // below, which turns it into a quote waiting in the composer.
  const [pageQuote, setPageQuote] = useState<{
    source: ElementType
    text: string
  } | null>(null)

  // Keeps the list picker inside the screen, flipping it
  // above the button when there is no room below. Called
  // before any early return so the hook order is stable.
  const registerMenuStyle = useDropdownPosition(
    registerOpen,
    registerRef,
    registerMenuRef
  )

  const { user, loading: authLoading } = useAuth()
  const { open } = useAuthModal()

  const isAdmin = hasRole(user, 'ADMIN')
  const guest = isGuest(user)
  // Sharing is for signed-in regular users and administrators;
  // guests and visitors get no share button.
  const canShare = hasRole(user, 'USER')

  // A "View Page" click on an event that has never been saved hands the form
  // over directly, so there is nothing to fetch.
  // The App Router has no location.state, so the draft preview is handed over
  // through sessionStorage by the event editor.
  //
  // It is read after mount rather than in the initialiser: the server cannot
  // see sessionStorage, so reading it during the first render would make the
  // client paint a preview the server never rendered, and would fire a fetch
  // for an event id that only exists on the client.
  const [draft, setDraft] = useState<EventDraft | null>(null)
  const [checkedDraft, setCheckedDraft] = useState(false)
  const preview = Boolean(draft)

  useEffect(() => {
    const stashed = takeNavigation<EventDraft>(EVENT_DRAFT_KEY)
    if (isDraft(stashed)) setDraft(stashed)
    setCheckedDraft(true)
  }, [])

  // The list picker closes on an outside click.
  useEffect(() => {
    if (!registerOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (
        registerRef.current &&
        !registerRef.current.contains(e.target as Node)
      ) {
        setRegisterOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [registerOpen])

  // An armed Unregister button disarms on its own, so a
  // stray second click cannot remove the registration.
  useEffect(() => {
    if (!unregisterArmed) return
    const timer = window.setTimeout(() => setUnregisterArmed(false), 3000)
    return () => window.clearTimeout(timer)
  }, [unregisterArmed])

  const loadEvent = useCallback(async () => {
    if (preview) return
    try {
      const response = key ? await eventsAPI.getEventByKey(key) : await eventsAPI.getEvent(id!)
      setEvent(response.data.event)
      setError('')
    } catch (err) {
      setError(apiErrorMessage(err, t('event.notFoundTitle')))
    } finally {
      setLoading(false)
    }
  }, [id, key, preview])

  useEffect(() => {
    // Wait until sessionStorage has been consulted: a stashed draft means
    // there is nothing to fetch, and fetching the placeholder id would 404.
    if (!checkedDraft) return
    if (preview) {
      setLoading(false)
      return
    }
    setLoading(true)
    loadEvent()
  }, [loadEvent, preview, checkedDraft])

  const backTo = resolveBackTarget({
    pathname,
    referrer: typeof document === 'undefined' ? '' : document.referrer,
    canGoBack: typeof window !== 'undefined' && window.history.length > 1,
  })

  const handleBack = () => {
    // Rewind the history when there is somewhere to go back to, which is what
    // the browser's own back arrow would do; otherwise use the recorded
    // referrer, then fall back to the event list.
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push(backTo)
  }

  /** Joins the picked list. */
  const handleRegister = async (listId: string) => {
    if (!user) {
      open('login')
      return
    }
    if (!event) return
    setRegisterOpen(false)
    setRegistering(true)
    try {
      await eventsAPI.register(event.id, listId)
      await loadEvent()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('event.registerFailed')))
    } finally {
      setRegistering(false)
    }
  }

  /** Moves the registration to another list. The API allows
      one registration per event, so the current one is
      removed before joining the new list. */
  const handleChangeList = async (listId: string) => {
    if (!event) return
    setRegisterOpen(false)
    setRegistering(true)
    try {
      await eventsAPI.unregister(event.id)
      await eventsAPI.register(event.id, listId)
      await loadEvent()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('event.registerFailed')))
      await loadEvent()
    } finally {
      setRegistering(false)
    }
  }

  /** The first click only highlights the button;
      the second one removes the registration. */
  const handleUnregisterClick = () => {
    if (!unregisterArmed) {
      setUnregisterArmed(true)
      return
    }
    handleUnregister()
  }

  const handleUnregister = async () => {
    if (!event) return
    setUnregisterArmed(false)
    setBusyUnregister(true)
    try {
      await eventsAPI.unregister(event.id)
      await loadEvent()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('event.cancelFailed')))
    } finally {
      setBusyUnregister(false)
    }
  }

  const handleToggleConfirm = async (registration: Registration) => {
    if (!event) return
    setBusyRegId(registration.id)
    try {
      await eventsAPI.updateRegistration(event.id, registration.id, {
        status: registration.status === 'CONFIRMED' ? 'PENDING' : 'CONFIRMED',
      })
      await loadEvent()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('event.confirmFailed')))
    } finally {
      setBusyRegId('')
    }
  }

  if (loading || authLoading) {
    return (
      <div className="event-page-loading">
        <div className="spinner" />
        <p>{t('event.loading')}</p>
      </div>
    )
  }

  if (error || (!event && !draft)) {
    return (
      <div className="event-page-error">
        <button className="btn btn-ghost btn-sm ep-back ep-back-standalone" onClick={handleBack}>
          <span className="ep-back-arrow" aria-hidden="true">
            ←
          </span>
          Back
        </button>
        <h2>{t('event.notFoundTitle')}</h2>
        <p>{error || 'The event you are looking for does not exist.'}</p>
        <Link className="btn btn-primary" href="/">
          {t('event.backToEvents')}
        </Link>
      </div>
    )
  }

  // A preview reuses the real event shape so every branch below is identical.
  const source: Event =
    event ??
    ({
      id: 'draft',
      key: 'draft',
      title: draft!.title || 'Untitled event',
      shortDescription: draft!.shortDescription,
      description: draft!.description || null,
      dateTime: draft!.dateTime,
      durationMinutes: draft!.durationMinutes,
      endsAt: draft!.endsAt,
      unpublishAfterEnd: draft!.unpublishAfterEnd,
      address: draft!.address || null,
      coverImage: draft!.coverImage || null,
      isPublished: false,
      creatorId: '',
      hostId: draft!.hostId || null,
      price: draft!.price,
      contactInfo: draft!.contactInfo || null,
      pageStyle: draft!.pageStyle,
      layout: draft!.layout,
      creator: { id: '', name: '', role: 'USER' },
      host: null,
      lists: [],
      userRegistration: null,
    } as Event)

  const eventDate = new Date(source.dateTime)
  const pageStyle = source.pageStyle || {}
  const elementStyles = (pageStyle.elementStyles || {}) as Record<
    string,
    { backgroundColor?: string; fontColor?: string }
  >

  const endsAt = eventEndsAt(source)
  const phase = eventPhase(source)
  const live = isEventLive(source)
  const durationLabel = formatDuration(source.durationMinutes)

  const stored = sanitizeLayout(source.layout)
  const layout: LayoutElement[] = (stored.length > 0 ? stored : DEFAULT_LAYOUT).slice()

  const wrapStyle = (type: ElementType) => {
    const s = elementStyles[type]
    return {
      backgroundColor: s?.backgroundColor,
      color: s?.fontColor,
    }
  }

  const renderElement = (el: LayoutElement) => {
    const wrapper = (children: React.ReactNode, id?: string) => (
      <div key={el.id} id={id} className={`ep-element ep-span-${el.span ?? 1}`}>
        {/* Every textual section can be quoted into the discussion below. */}
        {QUOTABLE_ELEMENTS.has(el.type) && (
          <button
            type="button"
            className="ep-quote-btn"
            title={t('comments.quoteElement')}
            aria-label={t('comments.quoteElement')}
            onClick={(e) => {
              const element = e.currentTarget.closest('.ep-element')
              const text = (element?.querySelector('.ep-block')?.textContent ?? '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 400)
              if (text) setPageQuote({ source: el.type, text })
            }}
          >
            ❝
          </button>
        )}
        {children}
      </div>
    )

    switch (el.type) {
      case 'coverImage': {
        const gallery = (source.images ?? []).map((i) => i.url).filter(Boolean)
        // Fall back to the legacy single cover when no gallery is stored.
        const urls = gallery.length > 0 ? gallery : source.coverImage ? [source.coverImage] : []
        const coverText = source.pageStyle?.coverText
        const hasCoverText = Boolean(
          coverText?.caption?.trim() || coverText?.description?.trim()
        )
        // Without an image the cover still renders when text is set, so a
        // text-only cover is possible.
        if (urls.length === 0 && !hasCoverText) return null
        const captionStyle: React.CSSProperties = {}
        if (coverText?.captionFontFamily) captionStyle.fontFamily = coverText.captionFontFamily
        if (coverText?.captionFontSize) captionStyle.fontSize = coverText.captionFontSize
        if (coverText?.captionFontColor) captionStyle.color = coverText.captionFontColor
        const descriptionStyle: React.CSSProperties = {}
        if (coverText?.descriptionFontFamily) descriptionStyle.fontFamily = coverText.descriptionFontFamily
        if (coverText?.descriptionFontSize) descriptionStyle.fontSize = coverText.descriptionFontSize
        if (coverText?.descriptionFontColor) descriptionStyle.color = coverText.descriptionFontColor
        return wrapper(
          <div
            className="ep-cover-frame"
            style={urls.length === 0 ? wrapStyle('coverImage') : undefined}
          >
            {urls.length > 0 && (
              <ImageCarousel
                images={urls}
                alt={source.title}
                style={wrapStyle('coverImage')}
              />
            )}
            {hasCoverText && (
              <div
                className={`ep-cover-text ep-v-${
                  coverText?.verticalAlignment ?? 'center'
                }`}
              >
                {coverText?.caption?.trim() && (
                  <p
                    className={`ep-cover-caption ep-align-${
                      coverText.captionAlignment ?? 'center'
                    }`}
                    style={captionStyle}
                  >
                    {coverText.caption}
                  </p>
                )}
                {coverText?.description?.trim() && (
                  <p
                    className={`ep-cover-description ep-align-${
                      coverText.descriptionAlignment ?? 'center'
                    }`}
                    style={descriptionStyle}
                  >
                    {coverText.description}
                  </p>
                )}
              </div>
            )}
          </div>
        )
      }

      case 'description':
        if (!source.description) return null
        return wrapper(
          <div className="ep-block" style={wrapStyle('description')}>
            <h3 className="ep-block-title">{t('event.about')}</h3>
            {/* Sanitized server-side against a tag/attribute allowlist. */}
            <div
              className="ep-rich"
              dangerouslySetInnerHTML={{ __html: source.description }}
            />
          </div>
        )

      case 'address':
        if (!source.address) return null
        return wrapper(
          <div className="ep-block" style={wrapStyle('address')}>
            <h3 className="ep-block-title">{t('event.address')}</h3>
            <p className="ep-copy">{source.address}</p>
          </div>
        )

      case 'host': {
        const hosts = (source.hosts?.length ? source.hosts : source.host ? [source.host] : []) as User[]
        if (hosts.length === 0) return null
        return wrapper(
          <div className="ep-block" style={wrapStyle('host')}>
            <h3 className="ep-block-title">
              {hosts.length === 1 ? t('event.host') : t('event.hosts')}
            </h3>
            <p className="ep-host-names">
              {hosts.map((h) => h.name).join(', ')}
            </p>
          </div>
        )
      }

      case 'price': {
        const items = source.priceItems ?? []
        const base = source.currency ?? '$'
        const show = (amount: number, cur = base) =>
          amount > 0 ? `${cur}${amount.toFixed(2)}` : t('event.free')
        if (source.price == null && items.length === 0) return null
        return wrapper(
          <div className="ep-block" style={wrapStyle('price')}>
            <h3 className="ep-block-title">{t('event.price')}</h3>
            <ul className="ep-price-list">
              {source.price != null && (
                <li className="ep-price-row">
                  <span className="ep-price-label">{t('event.fee')}</span>
                  <strong className="ep-price-value">{show(source.price)}</strong>
                </li>
              )}
              {items.map((item) => (
                <li
                  key={`${item.name}-${item.order ?? 0}`}
                  className="ep-price-row"
                >
                  <span className="ep-price-label">{item.name}</span>
                  {/* Each charge carries its own currency. */}
                  <strong className="ep-price-value">
                    {show(item.price, item.currency ?? base)}
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        )
      }

      case 'publicTags':
        if (!source.publicTags || source.publicTags.length === 0) return null
        return wrapper(
          <div className="ep-block" style={wrapStyle('publicTags')}>
            <h3 className="ep-block-title">{t('event.tags')}</h3>
            <ul className="ep-public-tags">
              {source.publicTags.map((t) => (
                <li key={t.id} className="ep-public-tag">
                  {t.name}
                </li>
              ))}
            </ul>
          </div>
        )

      case 'contactInfo': {
        if (source.contactMode === 'PROFILE') {
          const organizer = source.organizer
          if (!organizer) return null
          return wrapper(
            <div className="ep-block" style={wrapStyle('contactInfo')}>
              <h3 className="ep-block-title">{t('event.organizer')}</h3>
              <div className="ep-organizer">
                <UserAvatar name={organizer.name} avatar={organizer.avatar} size={36} />
                <div className="ep-organizer-text">
                  <span className="ep-organizer-name">{organizer.name}</span>
                  {organizer.email && (
                    <a className="ep-organizer-email" href={`mailto:${organizer.email}`}>
                      {organizer.email}
                    </a>
                  )}
                </div>
                <ContactMenu user={organizer} />
              </div>
            </div>
          )
        }
        if (!source.contactInfo) return null
        return wrapper(
          <div className="ep-block" style={wrapStyle('contactInfo')}>
            <h3 className="ep-block-title">{t('event.organizerContact')}</h3>
            <p className="ep-copy">{source.contactInfo}</p>
          </div>
        )
      }

      case 'lists':
        // The id lets the toolbox jump here, the way the discussion's
        // own id does below.
        return wrapper(
          <div className="ep-block" style={wrapStyle('lists')}>
            <h3 className="ep-block-title">{t('event.participantLists')}</h3>
            <div className="ep-lists">
              {source.lists?.map((list) => {
                const confirmedCount =
                  list.registrations?.filter((r) => r.status === 'CONFIRMED').length || 0
                return (
                  <div key={list.id} className="ep-list">
                    <div className="ep-list-header">
                      <h4>
                        {list.name}
                        {list.isDefault && <span className="ep-list-default">{t('event.defaultList')}</span>}
                      </h4>
                      <span className="ep-list-count">
                        {list.registrations?.length || 0} participant
                        {(list.registrations?.length || 0) === 1 ? '' : 's'}
                        {confirmedCount > 0 && ` · ${confirmedCount} confirmed`}
                      </span>
                    </div>
                    {list.registrations && list.registrations.length > 0 ? (
                      <ul className="ep-participants">
                        {list.registrations.map((reg) => (
                          <li
                            key={reg.id}
                            className={`ep-participant ${
                              reg.status === 'CONFIRMED' ? 'is-confirmed' : ''
                            }`}
                          >
                            <span className="ep-participant-avatar">
                              <UserAvatar
                                name={reg.user.name}
                                avatar={reg.user.avatar}
                                size={36}
                              />
                            </span>
                            <span className="ep-participant-name">{reg.user.name}</span>
                            {reg.status === 'CONFIRMED' && (
                              <span className="ep-confirmed-badge">✓ Confirmed</span>
                            )}
                            {isAdmin && (
                              <span className="ep-participant-admin">
                                <ContactMenu user={reg.user} />
                                <button
                                  type="button"
                                  className={`btn btn-sm ${
                                    reg.status === 'CONFIRMED' ? 'btn-secondary' : 'btn-primary'
                                  }`}
                                  disabled={busyRegId === reg.id}
                                  onClick={() => handleToggleConfirm(reg)}
                                >
                                  {reg.status === 'CONFIRMED' ? 'Unconfirm' : 'Confirm'}
                                </button>
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ep-empty-list">{t('event.noParticipants')}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>,
          'ep-lists'
        )

      default:
        return null
    }
  }

  const registration = source.userRegistration
  const isOpenForRegistration =
    !preview && source.isPublished && isRegistrationOpen(source) && !registration

  const lists = source.lists ?? []
  // "Change List" offers the other lists; "Register" offers all of them.
  const registerOptions = registration
    ? lists.filter((l) => l.id !== registration.list.id)
    : lists

  const registerDisabled =
    guest ||
    registerOptions.length === 0 ||
    (!registration && !isOpenForRegistration)

  const registerTitle = guest
    ? t('event.guestRegisterHint')
    : registerOptions.length === 0
      ? registration
        ? t('event.noOtherLists')
        : t('event.noLists')
      : !registration && !isOpenForRegistration
        ? t('event.registrationClosed')
        : undefined

  return (
    <div
      className="event-page"
      style={{ backgroundColor: pageStyle.backgroundColor, color: pageStyle.fontColor }}
    >
      <div className="ep-container" style={{ fontFamily: pageStyle.fontFamily }}>
        {preview && (
          <div className="ep-preview-banner" role="status">
            <strong>{t('event.draftBannerTitle')}</strong>
            <span>
              This event has not been created yet. It is not published and nobody can register for
              it.
            </span>
          </div>
        )}

        <div
          className="ep-sticky-bar"
          style={{ backgroundColor: pageStyle.backgroundColor }}
        >
          <div className="ep-titlerow">
            <h1 className="ep-title">{source.title}</h1>
            {live && (
              <span className="ep-live-badge">
                <span className="ep-live-dot" aria-hidden="true" />
                Happening now
              </span>
            )}
          </div>

          <div className="ep-actions">
            <button className="btn btn-ghost btn-sm ep-back" type="button" onClick={handleBack}>
              <span className="ep-back-arrow" aria-hidden="true">
                ←
              </span>
              Back
            </button>
            {isAdmin && !preview && source.isPublished && (
              <Link
                href={`/admin/events/${source.id}/edit`}
                className="btn btn-secondary btn-sm ep-edit-link"
              >
                Edit
              </Link>
            )}
            {canShare && !preview && (
              <ShareMenu event={source} locale={locale} />
            )}

            {!preview && (
              <div className="ep-register-menu" ref={registerRef}>
                <button
                  type="button"
                  className="btn btn-primary btn-sm ep-register-button"
                  onClick={() => {
                    if (!user) {
                      open('login')
                      return
                    }
                    setRegisterOpen((o) => !o)
                  }}
                  disabled={registerDisabled}
                  title={registerTitle}
                  aria-haspopup="menu"
                  aria-expanded={registerOpen}
                >
                  {registering
                    ? t('event.registering')
                    : registration
                      ? t('event.changeList')
                      : t('event.register')}
                  <span className="caret" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {registerOpen && (
                  <div
                    className="ep-register-dropdown"
                    role="menu"
                    ref={registerMenuRef}
                    style={registerMenuStyle}
                  >
                    {registerOptions.map((list) => (
                      <button
                        key={list.id}
                        type="button"
                        role="menuitem"
                        className="ep-register-option"
                        onClick={() =>
                          registration
                            ? handleChangeList(list.id)
                            : handleRegister(list.id)
                        }
                      >
                        <span>{list.name}</span>
                        {list.isDefault && (
                          <span className="ep-list-default">
                            {t('event.defaultList')}
                          </span>
                        )}
                      </button>
                    ))}
                    {registerOptions.length === 0 && (
                      <p className="ep-register-empty">
                        {registration
                          ? t('event.noOtherLists')
                          : t('event.noLists')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <header className="ep-header" id="ep-details">
          <div className="ep-header-meta">
            <div className="ep-header-chips">
              <span className="ep-header-chip">
                <span className="ep-header-chip-label">{t('event.date')}</span>
                {eventDate.toLocaleDateString(locale, { dateStyle: 'long' })}
              </span>
              <span className="ep-header-chip">
                <span className="ep-header-chip-label">{endsAt ? 'Time' : 'Starts'}</span>
                {formatEventTimeRange(source, locale)}
              </span>
              {endsAt && (
                <span className="ep-header-chip">
                  <span className="ep-header-chip-label">{t('event.duration')}</span>
                  {durationLabel}
                </span>
              )}
            </div>
            {source.shortDescription && (
              <p className="ep-header-summary">{source.shortDescription}</p>
            )}
          </div>

          {phase === 'ended' && !preview && (
            <p className="ep-header-note">{t('event.finished')}</p>
          )}
        </header>

        {registration && (
          <div className="ep-confirm">
            <span className="ep-confirm-text">
              <span className="ep-confirm-check" aria-hidden="true">
                ✓
              </span>
              {t('event.registeredIn')}: <strong>{registration.list.name}</strong>
              {registration.status === 'CONFIRMED' &&
                ` · ${t('event.confirmed')}`}
            </span>
            <button
              type="button"
              className={`btn btn-ghost btn-sm ep-unregister${
                unregisterArmed ? ' armed' : ''
              }`}
              onClick={handleUnregisterClick}
              disabled={busyUnregister}
            >
              {busyUnregister
                ? t('event.unregistering')
                : unregisterArmed
                  ? t('event.confirmUnregister')
                  : t('event.unregister')}
            </button>
          </div>
        )}

        <div className="ep-grid">{layout.map(renderElement)}</div>
      </div>

      {/* The discussion. A draft preview has nothing to discuss yet. */}
      {!preview && (
        <EventComments
          event={source}
          pageQuote={pageQuote}
          onPageQuoteConsumed={() => setPageQuote(null)}
        />
      )}

      {/* Page navigation: the event's details, the participant lists the
          page carries, and the discussion. Only the sections the page
          actually has are offered, and the toolbox itself sits above the
          sticky title bar, which is why its height is measured. */}
      {!preview && (
        <ToolboxNav
          sections={[
            { id: 'ep-details', icon: '📅', label: t('editor.sectionDetails') },
            ...(layout.some((el) => el.type === 'lists')
              ? [{ id: 'ep-lists', icon: '👥', label: t('editor.sectionLists') }]
              : []),
            { id: 'discussion', icon: '💬', label: t('comments.title') },
          ]}
          stickySelectors={['.ep-sticky-bar']}
        />
      )}
    </div>
  )
}

