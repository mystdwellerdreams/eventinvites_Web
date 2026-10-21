import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuth } from '../context/AuthContext'
import { eventsAPI, usersAPI, tagsAPI, eventTemplatesAPI, apiErrorMessage } from '../utils/api'
import { hasRole } from '../utils/roles'
import { ELEMENT_LABELS, ELEMENT_TYPES, defaultLayout, sanitizeLayout } from '../utils/layout'
import { stashNavigation, EVENT_DRAFT_KEY } from '../utils/navState'
import { formatDuration, joinDuration, splitDuration } from '../utils/eventTime'
import type {
  AfterStartPolicy,
  BannerAlignment,
  BannerVerticalAlignment,
  ContactMode,
  Currency,
  ElementType,
  EndTimeMode,
  Event,
  EventPriceItem,
  EventTemplate,
  EventTemplateData,
  LayoutElement,
  PageCoverText,
  Tag,
  User,
  VisibilityMode,
} from '../types'
import { CURRENCIES, CURRENCY_LABELS } from '../types'
import RichTextEditor from '../components/RichTextEditor'
import HostPicker from '../components/HostPicker'
import PriceItemsEditor from '../components/PriceItemsEditor'
import CoverImagesEditor, { type CoverImageRow } from '../components/CoverImagesEditor'
import TagCloud from '../components/TagCloud'
import ToolboxNav from '../components/ToolboxNav'
import EventRegistrationMenu from '../components/EventRegistrationMenu'
import { SOCIAL_PLATFORM_SPECS, socialLinkName } from '../utils/socialPlatforms'
import { useCaptcha } from '../context/CaptchaContext'
import {
  DESCRIPTION_FONT_SIZE_OPTIONS,
  FONT_SIZE_OPTIONS,
  AlignmentPicker,
  FontSizeSelect,
  FontStyleSelect,
  VerticalAlignmentPicker,
} from '../components/TextStyleControls'
import './AdminEventPage.css'
import { useI18n } from '../i18n'

export const FONT_OPTIONS = [
  { value: 'Inter, system-ui, sans-serif', label: 'Inter (Sans)' },
  { value: 'Georgia, "Times New Roman", serif', label: 'Georgia (Serif)' },
  { value: '"Fira Code", "Courier New", monospace', label: 'Fira Code (Mono)' },
  { value: '"Trebuchet MS", "Segoe UI", sans-serif', label: 'Trebuchet' },
  { value: '"Palatino Linotype", "Book Antiqua", serif', label: 'Palatino' },
  { value: 'Impact, "Arial Black", sans-serif', label: 'Impact' },
]

/**
 * A fresh cover text block. White text is the default because the text
 * sits over an image; an empty font family lets the page font apply.
 */
const EMPTY_COVER_TEXT: PageCoverText = {
  caption: '',
  captionAlignment: 'center',
  captionFontColor: '#ffffff',
  captionFontFamily: '',
  captionFontSize: '',
  description: '',
  descriptionAlignment: 'center',
  descriptionFontColor: '#ffffff',
  descriptionFontFamily: '',
  descriptionFontSize: '',
  verticalAlignment: 'center',
}

/** The event editor's text fields. */
interface EditorForm {
  title: string
  shortDescription: string
  description: string
  dateTime: string
  durationHours: string
  durationMinutesPart: string
  address: string
  coverImage: string
  key: string
  isPublished: boolean
  hostId: string
  price: string
  contactInfo: string
}

/** The event editor's page style. */
interface EditorStyle {
  backgroundColor: string
  fontColor: string
  fontFamily: string
  elementStyles: Record<string, { backgroundColor?: string; fontColor?: string }>
  coverText: PageCoverText
}

/**
 * Everything the editor holds, for the undo/redo history. The event
 * itself, the message line and the pickers' data stay out: they are not
 * edits the administrator makes field by field.
 */
interface EditorSnapshot {
  form: EditorForm
  style: EditorStyle
  layout: LayoutElement[]
  visibilityMode: VisibilityMode
  visibleTagIds: string[]
  hostIds: string[]
  organizerId: string
  contactMode: ContactMode
  endTimeMode: EndTimeMode
  fixedEndTime: string
  afterStartPolicy: AfterStartPolicy
  priceItems: EventPriceItem[]
  currency: Currency
  images: CoverImageRow[]
}

/** One recorded edit: the state it started from, and what it touched. */
interface HistoryStep {
  state: EditorSnapshot
  label: string
  at: number
}

/** How many steps the history keeps. */
const HISTORY_LIMIT = 60

/**
 * Edits to the same field inside this window join one step, so undoing a
 * burst of typing returns to where that field stood before it, not to the
 * letter before the last one.
 */
const COALESCE_MS = 700

/** What a history step is called, keyed by the label given to applyChange. */
const FIELD_LABELS: Record<string, string> = {
  title: 'editor.fieldTitle',
  isPublished: 'editor.fieldPublish',
  shortDescription: 'editor.fieldShortDescription',
  description: 'editor.fieldDescription',
  dateTime: 'editor.fieldDateTime',
  duration: 'editor.fieldDuration',
  address: 'editor.fieldAddress',
  key: 'editor.fieldKey',
  price: 'editor.fieldPrice',
  contactInfo: 'editor.fieldContactInfo',
  publish: 'editor.fieldPublish',
  endTime: 'editor.fieldEndTime',
  coverText: 'editor.fieldCoverText',
  font: 'editor.fieldFont',
  background: 'editor.fieldBackground',
  fontColor: 'editor.fieldFontColor',
  layout: 'editor.fieldLayout',
  visibility: 'editor.fieldVisibility',
  tags: 'editor.fieldTags',
  hosts: 'editor.fieldHosts',
  organizer: 'editor.fieldOrganizer',
  contactMode: 'editor.fieldContactMode',
  priceItems: 'editor.fieldPriceItems',
  currency: 'editor.fieldCurrency',
  images: 'editor.fieldImages',
  afterStart: 'editor.fieldAfterStart',
  template: 'editor.fieldTemplate',
}

const toLocalInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Just the clock portion, for a time-only input. */
const toTimeInput = (iso: string) => {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Combines the event's start date with a clock time to get the real end.
 *
 * The fixed-end option deliberately stores only a time, so an event that
 * finishes at 01:00 after a 22:00 start is treated as running past midnight
 * rather than being rejected as ending before it began.
 */
const resolveFixedEnd = (startIso: string, time: string): Date | null => {
  if (!time) return null
  const start = new Date(startIso)
  if (Number.isNaN(start.getTime())) return null

  const [hours, minutes] = time.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null

  const end = new Date(start)
  end.setHours(hours, minutes, 0, 0)
  if (end.getTime() <= start.getTime()) {
    end.setDate(end.getDate() + 1)
  }
  return end
}

/**
 * What the event page will show for the organizer once their profile is
 * chosen: their phone number and their social links, read from the
 * profile. It is a preview, not a second editor — the numbers are edited
 * on the user's own profile.
 */
function OrganizerContactPreview({
  users,
  organizerId,
}: {
  users: User[]
  organizerId: string
}) {
  const { t } = useI18n()
  const organizer = users.find((u) => u.id === organizerId)
  if (!organizer) return null

  const socials = organizer.socialLinks ?? []
  const hasAny = Boolean(organizer.phone) || socials.length > 0

  return (
    <div className="ae-organizer-preview">
      <span className="ae-organizer-preview-label">{t('editor.organizerContactPreview')}</span>
      {hasAny ? (
        <ul className="ae-organizer-preview-list">
          {organizer.phone && (
            <li>
              <span aria-hidden="true">📞</span>
              <a href={`tel:${organizer.phone}`}>{organizer.phone}</a>
            </li>
          )}
          {socials.map((link, i) => (
            <li key={`${link.platform}-${i}`}>
              <span aria-hidden="true">
                {SOCIAL_PLATFORM_SPECS[link.platform]?.icon ?? '🔗'}
              </span>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {socialLinkName(link)}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ae-hint">{t('editor.organizerNoContact')}</p>
      )}
    </div>
  )
}

export default function AdminEventPage() {
  const { t, locale } = useI18n()
  const { requireChallenge } = useCaptcha()
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const router = useRouter()
  const { user } = useAuth()

  const [form, setForm] = useState<EditorForm>({
    title: '',
    shortDescription: '',
    description: '',
    dateTime: toLocalInput(new Date(Date.now() + 7 * 86400000).toISOString()),
    durationHours: '1',
    durationMinutesPart: '0',
    address: '',
    coverImage: '',
    key: '',
    isPublished: false,
    hostId: '',
    price: '',
    contactInfo: '',
  })
  const [style, setStyle] = useState<EditorStyle>({
    backgroundColor: '#ffffff',
    fontColor: '#1f2937',
    fontFamily: FONT_OPTIONS[0].value,
    elementStyles: {},
    coverText: EMPTY_COVER_TEXT,
  })
  const [layout, setLayout] = useState<LayoutElement[]>(defaultLayout())
  const [users, setUsers] = useState<User[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>('ALL')
  const [visibleTagIds, setVisibleTagIds] = useState<string[]>([])
  const [hostIds, setHostIds] = useState<string[]>([])
  const [organizerId, setOrganizerId] = useState('')
  const [contactMode, setContactMode] = useState<ContactMode>('PROFILE')
  const [endTimeMode, setEndTimeMode] = useState<EndTimeMode>('DURATION')
  const [fixedEndTime, setFixedEndTime] = useState('')
  const [afterStartPolicy, setAfterStartPolicy] = useState<AfterStartPolicy>('UNPUBLISH_AT_START')
  const [priceItems, setPriceItems] = useState<EventPriceItem[]>([])
  const [currency, setCurrency] = useState<Currency>('$')
  const [images, setImages] = useState<CoverImageRow[]>([{ url: '' }])
  const [event, setEvent] = useState<Event | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  /* ------------------------------ edit history ------------------------------ */

  // Every edit the administrator makes: the steps behind, the steps
  // undone, and the ones redoing would replay.
  const [past, setPast] = useState<HistoryStep[]>([])
  const [future, setFuture] = useState<HistoryStep[]>([])

  /** The editor as it stands, for a history step. */
  const snapshot = (): EditorSnapshot => ({
    form,
    style,
    layout,
    visibilityMode,
    visibleTagIds,
    hostIds,
    organizerId,
    contactMode,
    endTimeMode,
    fixedEndTime,
    afterStartPolicy,
    priceItems,
    currency,
    images,
  })

  /** Puts a recorded state back into the editor's fields. */
  const restore = (s: EditorSnapshot) => {
    setForm(s.form)
    setStyle(s.style)
    setLayout(s.layout)
    setVisibilityMode(s.visibilityMode)
    setVisibleTagIds(s.visibleTagIds)
    setHostIds(s.hostIds)
    setOrganizerId(s.organizerId)
    setContactMode(s.contactMode)
    setEndTimeMode(s.endTimeMode)
    setFixedEndTime(s.fixedEndTime)
    setAfterStartPolicy(s.afterStartPolicy)
    setPriceItems(s.priceItems)
    setCurrency(s.currency)
    setImages(s.images)
  }

  /**
   * Records the current state and applies one edit. The label says what
   * changed, so the history bar can name the step; edits sharing a label
   * inside COALESCE_MS join the step already open.
   */
  const applyChange = (label: string, mutator: () => void) => {
    const now = Date.now()
    setPast((prev) => {
      const last = prev[prev.length - 1]
      if (last && last.label === label && now - last.at < COALESCE_MS) {
        // The step already holds where this field's burst began.
        return prev
      }
      return [...prev, { state: snapshot(), label, at: now }].slice(-HISTORY_LIMIT)
    })
    setFuture([])
    mutator()
  }

  const canUndo = past.length > 0
  const canRedo = future.length > 0

  const undo = () => {
    if (!canUndo) return
    const step = past[past.length - 1]
    setPast((prev) => prev.slice(0, -1))
    setFuture((f) =>
      [{ state: snapshot(), label: step.label, at: Date.now() }, ...f].slice(0, HISTORY_LIMIT)
    )
    restore(step.state)
  }

  const redo = () => {
    if (!canRedo) return
    const [step, ...rest] = future
    setPast((prev) =>
      [...prev, { state: snapshot(), label: step.label, at: Date.now() }].slice(-HISTORY_LIMIT)
    )
    setFuture(rest)
    restore(step.state)
  }

  // Ctrl+Z and Ctrl+Shift+Z walk the history, except while typing in a
  // field, where the browser's own undo belongs to the text.
  const historyRef = useRef({ undo, redo })
  historyRef.current = { undo, redo }
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.isContentEditable || /^(input|textarea|select)$/i.test(target.tagName))
      ) {
        return
      }
      e.preventDefault()
      if (e.shiftKey) historyRef.current.redo()
      else historyRef.current.undo()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  /** What a history step is called, for the history bar. */
  const stepLabel = (label: string) => {
    const key = FIELD_LABELS[label]
    return key ? t(key) : label
  }

  /* -------------------------------- templates ------------------------------- */

  const [templates, setTemplates] = useState<EventTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templatesMessage, setTemplatesMessage] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true)
    try {
      const r = await eventTemplatesAPI.list()
      setTemplates(r.data.templates)
      setTemplatesMessage('')
    } catch (err) {
      setTemplatesMessage(apiErrorMessage(err, t('editor.templatesLoadFailed')))
    } finally {
      setTemplatesLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadTemplates()
  }, [loadTemplates])

  /** The editor's settings as a template body: everything except what
   *  names this particular event. */
  const templateData = (): EventTemplateData => ({
    shortDescription: form.shortDescription,
    description: form.description || undefined,
    durationMinutes: durationTotal > 0 ? durationTotal : null,
    endTimeMode,
    afterStartPolicy,
    hostIds,
    organizerId: organizerId || null,
    contactMode,
    priceItems: priceItems
      .filter((item) => item.name.trim().length > 0)
      .map((item) => ({
        name: item.name.trim(),
        price: Number(item.price) || 0,
        currency: item.currency ?? currency,
      })),
    address: form.address || undefined,
    images: images.map((i) => i.url.trim()).filter(Boolean),
    visibilityMode,
    visibleTagIds,
    // The same encoding the save button uses: an empty field leaves the
    // stored price alone rather than recording "no price".
    price: form.price === '' ? undefined : Number(form.price),
    currency,
    contactInfo: form.contactInfo || undefined,
    pageStyle: style,
    layout,
  })

  const handleSaveTemplate = async () => {
    const name = templateName.trim()
    if (!name || savingTemplate) return
    setSavingTemplate(true)
    setTemplatesMessage('')
    try {
      await eventTemplatesAPI.create(name, templateData())
      setTemplateName('')
      setTemplatesMessage(t('editor.templateSaved', { name }))
      await loadTemplates()
    } catch (err) {
      setTemplatesMessage(apiErrorMessage(err, t('editor.templateSaveFailed')))
    } finally {
      setSavingTemplate(false)
    }
  }

  /** Applies a saved template, recorded as one history step so it can be
   *  undone like any other edit. */
  const handleApplyTemplate = (template: EventTemplate) => {
    const data = template.data
    applyChange('template', () => {
      const duration = splitDuration(data.durationMinutes ?? null)
      setForm((f) => ({
        ...f,
        shortDescription: data.shortDescription ?? f.shortDescription,
        description: data.description ?? '',
        durationHours: String(duration.hours),
        durationMinutesPart: String(duration.minutes),
        address: data.address ?? '',
        price: data.price != null ? String(data.price) : '',
        contactInfo: data.contactInfo ?? '',
      }))
      setEndTimeMode(data.endTimeMode ?? 'DURATION')
      // A template carries no end time of its own, so a fixed-end template
      // never inherits the previously loaded event's: the administrator
      // picks the time themselves, as the form's end-time input shows.
      setFixedEndTime('')
      setAfterStartPolicy(data.afterStartPolicy ?? 'UNPUBLISH_AT_START')
      setPriceItems(
        (data.priceItems ?? []).map((p) => ({
          name: p.name,
          price: p.price,
          // Each item's own currency, kept so a charge saved in one
          // currency does not come back priced in another.
          currency: p.currency,
        }))
      )
      setCurrency(data.currency ?? '$')
      setImages(data.images?.length ? data.images.map((url) => ({ url })) : [{ url: '' }])
      setHostIds(data.hostIds ?? [])
      setOrganizerId(data.organizerId ?? '')
      setContactMode(data.contactMode ?? 'PROFILE')
      if (data.pageStyle) {
        setStyle({
          backgroundColor: data.pageStyle.backgroundColor || '#ffffff',
          fontColor: data.pageStyle.fontColor || '#1f2937',
          fontFamily: data.pageStyle.fontFamily || FONT_OPTIONS[0].value,
          elementStyles: data.pageStyle.elementStyles || {},
          coverText: { ...EMPTY_COVER_TEXT, ...(data.pageStyle.coverText ?? {}) },
        })
      }
      const sanitized = sanitizeLayout(data.layout ?? [])
      if (sanitized.length > 0) setLayout(sanitized)
      setVisibilityMode(data.visibilityMode ?? 'ALL')
      setVisibleTagIds(data.visibleTagIds ?? [])
    })
    setTemplatesMessage(t('editor.templateApplied', { name: template.name }))
  }

  const handleDeleteTemplate = async (template: EventTemplate) => {
    try {
      await eventTemplatesAPI.remove(template.id)
      setTemplatesMessage(t('editor.templateDeleted', { name: template.name }))
      await loadTemplates()
    } catch (err) {
      setTemplatesMessage(apiErrorMessage(err, t('editor.templateDeleteFailed')))
    }
  }

  /** Sets one text field, recorded in the history under its own name. */
  const set = (key: string, value: unknown) =>
    applyChange(key, () => setForm((f) => ({ ...f, [key]: value })))

  /** Edits one field of the cover text, keeping the rest of the block. */
  const patchCoverText = (patch: Partial<PageCoverText>) =>
    applyChange('coverText', () =>
      setStyle((s) => ({ ...s, coverText: { ...s.coverText, ...patch } }))
    )

  const durationTotal = joinDuration(
    Number(form.durationHours) || 0,
    Number(form.durationMinutesPart) || 0
  )

  const setDurationPart = (key: 'durationHours' | 'durationMinutesPart', value: string) =>
    applyChange('duration', () => setForm((f) => ({ ...f, [key]: value })))

  /** Fills the editor from a server response. */
  const applyEvent = (e: Event) => {
    setEvent(e)
    const duration = splitDuration(e.durationMinutes)
    setForm({
      title: e.title,
      shortDescription: e.shortDescription,
      description: e.description || '',
      dateTime: toLocalInput(e.dateTime),
      durationHours: String(duration.hours),
      durationMinutesPart: String(duration.minutes),
      address: e.address || '',
      coverImage: e.coverImage || '',
      key: e.key === 'draft' ? '' : e.key || '',
      isPublished: e.isPublished,
      hostId: '',
      price: e.price != null ? String(e.price) : '',
      contactInfo: e.contactInfo || '',
    })
    setEndTimeMode(e.endTimeMode ?? 'DURATION')
    setFixedEndTime(e.endsAt ? toTimeInput(e.endsAt) : '')
    setAfterStartPolicy(e.afterStartPolicy ?? 'UNPUBLISH_AT_START')
    setPriceItems((e.priceItems ?? []).map((p) => ({ name: p.name, price: p.price })))
    setCurrency(e.currency ?? '$')
    setImages(
      e.images?.length
        ? e.images.map((i) => ({ url: i.url }))
        : e.coverImage
          ? [{ url: e.coverImage }]
          : [{ url: '' }]
    )
    setHostIds((e.hosts ?? []).map((h) => h.id))
    // A cleared organizer stays cleared: seeding the creator back in would
    // undo the removal in the editor and disagree with the event page,
    // which shows no organizer block when none is set.
    setOrganizerId(e.organizerId ?? '')
    setContactMode(e.contactMode ?? 'PROFILE')
    if (e.pageStyle) {
      setStyle({
        backgroundColor: e.pageStyle.backgroundColor || '#ffffff',
        fontColor: e.pageStyle.fontColor || '#1f2937',
        fontFamily: e.pageStyle.fontFamily || FONT_OPTIONS[0].value,
        elementStyles: e.pageStyle.elementStyles || {},
        coverText: { ...EMPTY_COVER_TEXT, ...(e.pageStyle.coverText ?? {}) },
      })
    }
    const sanitized = sanitizeLayout(e.layout)
    if (sanitized.length > 0) {
      setLayout(sanitized)
    }
    setVisibilityMode(e.visibilityMode ?? 'ALL')
    setVisibleTagIds((e.visibleTags ?? []).map((t) => t.id))
  }

  const loadEvent = useCallback(
    async (eventId: string) => {
      try {
        const r = await eventsAPI.getEvent(eventId)
        applyEvent(r.data.event as Event)
        // The loaded event is the history's starting point.
        setPast([])
        setFuture([])
      } catch (err) {
        setMessage(apiErrorMessage(err, t('editor.loadFailed')))
      }
    },
    // The loaded event replaces the editor wholesale, so it is not an edit
    // the history steps through.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  useEffect(() => {
    usersAPI
      .getAll()
      .then((r) => setUsers(r.data.users as User[]))
      .catch(() => setUsers([]))
    tagsAPI
      .list()
      .then((r) => setTags(r.data.tags as Tag[]))
      .catch(() => setTags([]))
    if (id) loadEvent(id)
  }, [id, loadEvent])

  useEffect(() => {
    if (user && !isEdit && !form.contactInfo) {
      setForm((f) => ({
        ...f,
        contactInfo: [user.phone, user.email].filter(Boolean).join(' · '),
      }))
    }
    // Seeds the organizer contact with the creator's own details.
  }, [user, isEdit, form.contactInfo])

  const moveElement = (index: number, direction: -1 | 1) =>
    applyChange('layout', () => {
      const next = [...layout]
      const target = index + direction
      if (target < 0 || target >= next.length) return
      ;[next[index], next[target]] = [next[target], next[index]]
      setLayout(next.map((el, i) => ({ ...el, order: i })))
    })

  const toggleElement = (type: ElementType) =>
    applyChange('layout', () => {
      if (layout.some((l) => l.type === type)) {
        setLayout(layout.filter((l) => l.type !== type).map((el, i) => ({ ...el, order: i })))
      } else {
        setLayout([...layout, { id: type, type, order: layout.length, span: 1 }])
      }
    })

  const toggleSpan = (type: ElementType) =>
    applyChange('layout', () =>
      setLayout(layout.map((el) => (el.type === type ? { ...el, span: el.span === 2 ? 1 : 2 } : el)))
    )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMessage('')

    // A new event asks for a security check first, over the whole screen;
    // editing an existing one does not, because the event already exists.
    if (!isEdit) {
      requireChallenge('event-create', (token) => {
        void saveEvent(token)
      })
      return
    }
    await saveEvent()
  }

  /** The save itself, once any challenge is cleared. */
  const saveEvent = async (captchaToken?: string | null) => {
    const payload = {
      title: form.title,
      // Left undefined so the server generates one when the field is blank.
      ...(form.key.trim() ? { key: form.key.trim() } : {}),
      shortDescription: form.shortDescription,
      description: form.description || undefined,
      dateTime: new Date(form.dateTime).toISOString(),
      // `null` clears a stored duration; omitting the field would leave it alone.
      durationMinutes: durationTotal > 0 ? durationTotal : null,
      endTimeMode,
      endsAt:
        endTimeMode === 'FIXED' && fixedEndTime
          ? resolveFixedEnd(form.dateTime, fixedEndTime)?.toISOString() ?? null
          : null,
      afterStartPolicy,
      hostIds,
      organizerId: organizerId || null,
      contactMode,
      priceItems: priceItems
        .filter((item) => item.name.trim().length > 0)
        .map((item) => ({
          name: item.name.trim(),
          price: Number(item.price) || 0,
          currency: item.currency ?? currency,
        })),
      address: form.address || undefined,
      images: images.map((i) => i.url.trim()).filter(Boolean),
      isPublished: form.isPublished,
      visibilityMode,
      visibleTagIds,
      hostId: form.hostId || undefined,
      price: form.price === '' ? undefined : Number(form.price),
      currency,
      contactInfo: form.contactInfo || undefined,
      pageStyle: style,
      layout,
    }

    try {
      if (isEdit) {
        const r = await eventsAPI.update(id!, payload)
        // Adopt the server's view of the event so the preview and the
        // publish button stay in step with what was actually stored.
        applyEvent(r.data.event as Event)
        setMessage(t('editor.eventUpdated'))
      } else {
        const r = await eventsAPI.create(payload, captchaToken)
        router.push(`/admin/events/${r.data.event.id}/edit`)
      }
    } catch (err) {
      setMessage(apiErrorMessage(err, t('editor.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  /** Publishes or unpublishes without touching anything else on the form. */
  const handleTogglePublish = async () => {
    const next = !form.isPublished
    const previous = form.isPublished
    set('isPublished', next)
    if (!isEdit || !id) return

    setSaving(true)
    try {
      const r = await eventsAPI.update(id, { isPublished: next })
      applyEvent(r.data.event as Event)
      setMessage(t(next ? 'editor.publishedOk' : 'editor.unpublishedOk'))
    } catch (err) {
      set('isPublished', previous)
      setMessage(apiErrorMessage(err, t('editor.publishFailed')))
    } finally {
      setSaving(false)
    }
  }

  /**
   * "View Page" shows the event exactly as a visitor would see it. Before the
   * event exists there is nothing to open, so the unsaved form is handed to
   * the event page as a draft and rendered as a preview.
   */
  const handleViewPage = () => {
    const target = event
      ? `/events/${event.id}`
      : '/events/preview'

    if (event) {
      router.push(target)
      return
    }

    const startsAt = new Date(form.dateTime)
    const endsAt =
      endTimeMode === 'FIXED' && fixedEndTime
        ? resolveFixedEnd(form.dateTime, fixedEndTime)?.toISOString() ?? null
        : durationTotal > 0
          ? new Date(startsAt.getTime() + durationTotal * 60000).toISOString()
          : null
    const draft = {
      title: form.title || 'Untitled event',
      shortDescription: form.shortDescription,
      description: form.description,
      dateTime: startsAt.toISOString(),
      durationMinutes: durationTotal > 0 ? durationTotal : null,
      endsAt,
      endTimeMode,
      afterStartPolicy,
      visibilityMode,
      contactMode,
      address: form.address,
      coverImage: form.coverImage,
      // The images the administrator uploaded, so the preview shows the
      // cover they will see rather than an empty one.
      images: images.map((i) => ({ url: i.url.trim() })).filter((i) => i.url),
      price: form.price === '' ? null : Number(form.price),
      priceItems: priceItems.filter((i) => i.name.trim()),
      contactInfo: form.contactInfo,
      hostIds,
      pageStyle: style,
      layout,
    }
    stashNavigation(EVENT_DRAFT_KEY, draft)
    router.push(target)
  }

  if (user && !hasRole(user, 'ADMIN')) {
    return (
      <div className="admin-denied">
        <h2>{t('admin.accessDeniedTitle')}</h2>
        <p>{t('admin.accessDeniedBody')}</p>
      </div>
    )
  }

  return (
    <div className="admin-event-page">
      {/* The editor's own bar: the label sits above the row of actions,
          and the whole bar stays under the site header while the form
          scrolls, so Back, View Page and Publish are always reachable. */}
      <div className="ae-header">
        <h1>{isEdit ? t('editor.editPage') : t('editor.createPage')}</h1>
        <div className="ae-header-row">
          <button className="btn btn-ghost btn-sm" onClick={() => router.push('/admin')}>
            ← Back
          </button>
          <div className="ae-header-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleViewPage}
              title={
                event
                  ? 'Open the published event page'
                  : 'Preview this event page before it is created'
              }
            >
              View Page
            </button>
            <button
              type="button"
              className={`btn btn-sm ${form.isPublished ? 'btn-secondary' : 'btn-primary'}`}
              onClick={handleTogglePublish}
              disabled={saving}
              aria-pressed={form.isPublished}
            >
              {form.isPublished ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </div>
      </div>

      {form.isPublished && (
        <div className="ae-published-note">
          <span className="ae-published-dot" aria-hidden="true" />
          Published — this event is listed on the home page and open for registration.
        </div>
      )}

      {event && (
        <div className="ae-key-box">
          <strong>{t('editor.uniqueKey')}:</strong> <code>{event.key}</code>
          <span className="ae-key-url">/events/key/{event.key}</span>
        </div>
      )}

      {/* The edit history, at the top of the editor: what the undo and
          redo buttons below would step through. */}
      <div className="ae-history" role="status" aria-live="polite">
        <span className="ae-history-icon" aria-hidden="true">
          🕘
        </span>
        <div className="ae-history-body">
          <strong>{t('editor.history')}</strong>
          <span className="ae-history-state">
            {past.length === 0 && future.length === 0
              ? t('editor.historyEmpty')
              : `${t('editor.historyBack', { count: past.length })} · ${t('editor.historyForward', { count: future.length })}`}
          </span>
          <span className="ae-history-hint">{t('editor.historyHint')}</span>
        </div>
        {canUndo ? (
          <span className="ae-history-next">
            ↶ {t('editor.historyNextUndo', {
              label: stepLabel(past[past.length - 1].label),
            })}
          </span>
        ) : canRedo ? (
          <span className="ae-history-next">
            ↷ {t('editor.historyNextRedo', {
              label: stepLabel(future[0].label),
            })}
          </span>
        ) : null}
      </div>

      <form onSubmit={handleSubmit} className="ae-form">
        {/* Saved settings the editor can start from, at the top of the form. */}
        <section id="ae-templates" className="ae-card ae-templates">
          <h2>{t('editor.templates')}</h2>
          <p className="ae-hint">{t('editor.templatesIntro')}</p>

          <div className="ae-template-save">
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder={t('editor.templateNamePlaceholder')}
              aria-label={t('editor.templateName')}
              maxLength={80}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleSaveTemplate()}
              disabled={!templateName.trim() || savingTemplate}
            >
              {savingTemplate ? t('editor.savingTemplate') : t('editor.saveTemplate')}
            </button>
          </div>

          {templatesMessage && <p className="ae-template-message">{templatesMessage}</p>}

          {templatesLoading ? (
            <p className="ae-template-status">{t('editor.templatesLoading')}</p>
          ) : templates.length === 0 ? (
            <p className="ae-template-status">{t('editor.templatesEmpty')}</p>
          ) : (
            <ul className="ae-template-list">
              {templates.map((template) => (
                <li key={template.id} className="ae-template-item">
                  <div className="ae-template-info">
                    <strong>{template.name}</strong>
                    <span>
                      {t('editor.templateBy', { name: template.createdBy.name })}
                      {' · '}
                      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                        new Date(template.createdAt)
                      )}
                    </span>
                  </div>
                  <div className="ae-template-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => handleApplyTemplate(template)}
                    >
                      {t('editor.applyTemplate')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void handleDeleteTemplate(template)}
                      aria-label={t('editor.deleteTemplate')}
                      title={t('editor.deleteTemplate')}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section id="ae-details" className="ae-card">
          <h2>{t('editor.eventDetails')}</h2>
          <p className="ae-hint">
            The title, date and time always appear in the page header. Everything below is a page
            element you can reorder and style.
          </p>

          <div className="form-group">
            <label htmlFor="title">{t('editor.title')}</label>
            <input
              id="title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              required
              minLength={3}
            />
          </div>

          <div className="ae-row ae-row--stack">
            <div className="form-group">
              <label htmlFor="dateTime">Date &amp; Time (page header)</label>
              <input
                id="dateTime"
                type="datetime-local"
                value={form.dateTime}
                onChange={(e) => set('dateTime', e.target.value)}
                required
              />
              <div className="ae-duration">
                <span className="ae-duration-label">{t('editor.endOfEvent')}</span>
                <div className="ae-endtime-modes" role="radiogroup" aria-label="How the end time is set">
                  <label
                    className={`tag-mode ${endTimeMode === 'DURATION' ? 'is-active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="endTimeMode"
                      checked={endTimeMode === 'DURATION'}
                      onChange={() => applyChange('endTime', () => setEndTimeMode('DURATION'))}
                    />
                    <span className="tag-mode-text">
                      <strong>{t('editor.endByDuration')}</strong>
                      <span>{t('editor.endByDurationHelp')}</span>
                    </span>
                  </label>
                  <label
                    className={`tag-mode ${endTimeMode === 'FIXED' ? 'is-active' : ''}`}
                  >
                    <input
                      type="radio"
                      name="endTimeMode"
                      checked={endTimeMode === 'FIXED'}
                      onChange={() => applyChange('endTime', () => setEndTimeMode('FIXED'))}
                    />
                    <span className="tag-mode-text">
                      <strong>{t('editor.endByFixed')}</strong>
                      <span>{t('editor.endByFixedHelp')}</span>
                    </span>
                  </label>
                </div>

                {endTimeMode === 'DURATION' ? (
                  <>
                    <div className="ae-duration-inputs">
                      <input
                        type="number"
                        min="0"
                        max="720"
                        aria-label="Duration in hours"
                        value={form.durationHours}
                        onChange={(e) => setDurationPart('durationHours', e.target.value)}
                      />
                      <span className="ae-duration-unit">h</span>
                      <input
                        type="number"
                        min="0"
                        max="55"
                        step="5"
                        aria-label="Duration in minutes"
                        value={form.durationMinutesPart}
                        onChange={(e) => setDurationPart('durationMinutesPart', e.target.value)}
                      />
                      <span className="ae-duration-unit">min</span>
                    </div>
                    <p className="ae-hint ae-duration-hint">
                      {durationTotal > 0 ? (
                        <>
                          Runs for <strong>{formatDuration(durationTotal)}</strong>. While it is
                          running the home page card shows a “Happening now” label.
                        </>
                      ) : (
                        'Leave the duration blank for an event at a single point in time.'
                      )}
                    </p>
                  </>
                ) : (
                  <>
                    <input
                      type="time"
                      className="ae-endtime-input"
                      aria-label="Specific end time"
                      value={fixedEndTime}
                      onChange={(e) => applyChange('endTime', () => setFixedEndTime(e.target.value))}
                    />
                    <p className="ae-hint ae-duration-hint">
                      Only the time is needed: the end date is taken from the event&rsquo;s start
                      date. A time earlier than the start means the event finishes the next day.
                      Leave the duration blank if you set a specific end time without a duration.
                    </p>
                  </>
                )}
              </div>

              <div className="ae-duration">
                <span className="ae-duration-label">{t('editor.afterStart')}</span>
                <div className="tag-visibility-modes" role="radiogroup" aria-label="Behaviour after the start time">
                  {(
                    [
                      [
                        'UNPUBLISH_AT_START',
                        'Unpublish when the event starts',
                        'The event leaves the home page the moment it begins.',
                      ],
                      [
                        'KEEP_PUBLISHED_LOCKED',
                        'Keep published but lock it',
                        'Stays listed, but registration closes when the event begins.',
                      ],
                      [
                        'OPEN_AFTER_START',
                        'Allow registration to continue',
                        'Stays listed and keeps accepting registrations until it finishes.',
                      ],
                    ] as [AfterStartPolicy, string, string][]
                  ).map(([mode, label, help]) => (
                    <label
                      key={mode}
                      className={`tag-mode ${afterStartPolicy === mode ? 'is-active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="afterStartPolicy"
                        checked={afterStartPolicy === mode}
                        onChange={() => applyChange('afterStart', () => setAfterStartPolicy(mode))}
                      />
                      <span className="tag-mode-text">
                        <strong>{label}</strong>
                        <span>{help}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="price">{t('editor.price')}</label>
              <div className="ae-price-row">
                <input
                  id="price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.price}
                  onChange={(e) => set('price', e.target.value)}
                  placeholder="Free"
                />
                <label className="ae-currency-label" htmlFor="currency">
                  Currency
                </label>
                <select
                  id="currency"
                  value={currency}
                  onChange={(e) => applyChange('currency', () => setCurrency(e.target.value as Currency))}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {CURRENCY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <PriceItemsEditor
                items={priceItems}
                onChange={(items: EventPriceItem[]) => applyChange('priceItems', () => setPriceItems(items))}
                currency={currency}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="shortDescription">{t('editor.shortDescription')}</label>
            <input
              id="shortDescription"
              value={form.shortDescription}
              onChange={(e) => set('shortDescription', e.target.value)}
              required
              minLength={10}
            />
          </div>

          <div className="form-group">
            <label htmlFor="description">{t('editor.description')}</label>
            <RichTextEditor
              value={form.description}
              onChange={(html) => applyChange('description', () => setForm((f) => ({ ...f, description: html })))}
              ariaLabel="Event description"
            />
            <p className="ae-hint">
              Formatting is limited to bold, italic, underline, strikethrough, alignment,
              colour, highlight, size, lists, links and emoji.
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="address">{t('editor.address')}</label>
            <input
              id="address"
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="key">{t('editor.keyLabel')}</label>
            <input
              id="key"
              value={form.key}
              onChange={(e) => set('key', e.target.value)}
              placeholder="autumn-gala-2026"
              spellCheck={false}
            />
            <p className="ae-hint">
              Leave blank and a random key is generated. The page is then reachable at{' '}
              <code>/events/key/{form.key || '…'}</code>. Changing an existing key breaks any link
              already shared for it.
            </p>
          </div>

          <div className="form-group">
            <label>{t('editor.images')}</label>
            <CoverImagesEditor images={images} onChange={(rows: CoverImageRow[]) => applyChange('images', () => setImages(rows))} />
            <p className="ae-hint">
              The first image is the cover. When more than one is set, visitors can cycle through
              them on the event page with the arrows or by swiping.
            </p>
          </div>

          <div className="ae-row ae-row--stack">
            <div className="form-group">
              <HostPicker
                users={users}
                selectedIds={hostIds}
                onChange={(ids: string[]) => applyChange('hosts', () => setHostIds(ids))}
                label="Hosts"
              />
              <p className="ae-hint">
                Search the user list and pick one or more people to host this event.
              </p>
            </div>
            <div className="form-group">
              <span className="ae-duration-label">{t('editor.organizerContact')}</span>
              <div className="tag-visibility-modes" role="radiogroup" aria-label="Organizer contact source">
                <label className={`tag-mode ${contactMode === 'PROFILE' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="contactMode"
                    checked={contactMode === 'PROFILE'}
                    onChange={() => applyChange('contactMode', () => setContactMode('PROFILE'))}
                  />
                  <span className="tag-mode-text">
                    <strong>{t('editor.organizerProfile')}</strong>
                    <span>Show their name, avatar and contact buttons on the page.</span>
                  </span>
                </label>
                <label className={`tag-mode ${contactMode === 'CUSTOM' ? 'is-active' : ''}`}>
                  <input
                    type="radio"
                    name="contactMode"
                    checked={contactMode === 'CUSTOM'}
                    onChange={() => applyChange('contactMode', () => setContactMode('CUSTOM'))}
                  />
                  <span className="tag-mode-text">
                    <strong>{t('editor.organizerCustom')}</strong>
                    <span>{t('editor.organizerCustomHelp')}</span>
                  </span>
                </label>
              </div>

              {contactMode === 'PROFILE' ? (
                <div className="form-group" style={{ marginTop: 10 }}>
                  {/* The same searchable user pick the hosts use: one
                      selection, and a second pick replaces the first. */}
                  <HostPicker
                    users={users}
                    selectedIds={organizerId ? [organizerId] : []}
                    onChange={(ids) =>
                      applyChange('organizer', () => {
                        const added = ids.find((id) => id !== organizerId)
                        setOrganizerId(added ?? '')
                      })
                    }
                    label="editor.organizer"
                  />
                  {organizerId && <OrganizerContactPreview users={users} organizerId={organizerId} />}
                </div>
              ) : (
                <div className="form-group" style={{ marginTop: 10 }}>
                  <label htmlFor="contactInfo">{t('editor.customContact')}</label>
                  <input
                    id="contactInfo"
                    value={form.contactInfo}
                    onChange={(e) => set('contactInfo', e.target.value)}
                    placeholder="Phone, email or a social link"
                  />
                </div>
              )}
            </div>
          </div>

          <p className="ae-hint">
            Use the Publish button in the top right to list this event on the home page and open it
            for registration.
          </p>
        </section>

        <section id="ae-visibility" className="ae-card">
          <h2>{t('editor.visibility')}</h2>
          <p className="ae-hint">
            Control who can find and register for this event. Administrators always see every event,
            whatever is set here. Tags are never shown to regular users.
          </p>

          <div className="tag-visibility">
            <div className="tag-visibility-modes">
              {(
                [
                  ['ALL', 'Everyone', 'Any visitor can see and register for this event.'],
                  [
                    'INCLUDE',
                    'Only listed tags',
                    'Visible only to users who hold at least one of the selected tags.',
                  ],
                  [
                    'EXCLUDE',
                    'Everyone except listed',
                    'Visible to everyone except users holding one of the selected tags.',
                  ],
                ] as [VisibilityMode, string, string][]
              ).map(([mode, label, help]) => (
                <label
                  key={mode}
                  className={`tag-mode ${visibilityMode === mode ? 'is-active' : ''}`}
                >
                  <input
                    type="radio"
                    name="visibilityMode"
                    value={mode}
                    checked={visibilityMode === mode}
                    onChange={() => applyChange('visibility', () => setVisibilityMode(mode))}
                  />
                  <span className="tag-mode-text">
                    <strong>{label}</strong>
                    <span>{help}</span>
                  </span>
                </label>
              ))}
            </div>

            {visibilityMode !== 'ALL' && (
              <div className="tag-picker">
                <TagCloud
                  tags={tags}
                  size="sm"
                  activeIds={visibleTagIds}
                  onSelect={(tagId) =>
                    applyChange('tags', () =>
                      setVisibleTagIds((ids) =>
                        ids.includes(tagId) ? ids.filter((i) => i !== tagId) : [...ids, tagId]
                      )
                    )
                  }
                  emptyHint="No tags exist yet. Create them on the Admin dashboard under Tags."
                />
                <p className="ae-hint">Click a tag to include it. These decide who can see the event.</p>
                {visibleTagIds.length === 0 && (
                  <p className="ae-hint ae-tag-warning">
                    {visibilityMode === 'INCLUDE'
                      ? 'No tags selected: this event is currently visible to nobody without an administrator role.'
                      : 'No tags selected: this event is currently visible to everyone.'}
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        <section id="ae-styling" className="ae-card">
          <h2>{t('editor.pageStyling')}</h2>
          <div className="ae-row">
            <div className="form-group">
              <label htmlFor="bgColor">{t('editor.backgroundColor')}</label>
              <input
                id="bgColor"
                type="color"
                value={style.backgroundColor}
                onChange={(e) => applyChange('background', () => setStyle({ ...style, backgroundColor: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="fontColor">{t('editor.fontColor')}</label>
              <input
                id="fontColor"
                type="color"
                value={style.fontColor}
                onChange={(e) => applyChange('fontColor', () => setStyle({ ...style, fontColor: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label htmlFor="fontFamily">{t('editor.fontType')}</label>
              <select
                id="fontFamily"
                value={style.fontFamily}
                onChange={(e) => applyChange('font', () => setStyle({ ...style, fontFamily: e.target.value }))}
              >
                {FONT_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section id="ae-cover-text" className="ae-card">
          <h2>{t('editor.coverText')}</h2>
          <p className="ae-hint">{t('editor.coverTextHint')}</p>

          <div className="form-group">
            <label htmlFor="cover-caption">{t('editor.coverCaption')}</label>
            <input
              id="cover-caption"
              value={style.coverText.caption ?? ''}
              onChange={(e) => patchCoverText({ caption: e.target.value })}
              maxLength={500}
            />
          </div>

          <div className="ae-row">
            <div className="form-group">
              <span className="ae-duration-label">{t('banner.alignment')}</span>
              <AlignmentPicker
                name="cover-caption-alignment"
                value={style.coverText.captionAlignment ?? 'center'}
                label={t('banner.alignment')}
                onChange={(captionAlignment) => patchCoverText({ captionAlignment })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="cover-caption-color">{t('banner.fontColor')}</label>
              <input
                id="cover-caption-color"
                type="color"
                value={style.coverText.captionFontColor || '#ffffff'}
                onChange={(e) => patchCoverText({ captionFontColor: e.target.value })}
              />
            </div>
          </div>

          <div className="ae-row">
            <div className="form-group">
              <label htmlFor="cover-caption-font-family">{t('banner.fontStyle')}</label>
              <FontStyleSelect
                id="cover-caption-font-family"
                value={style.coverText.captionFontFamily ?? ''}
                onChange={(captionFontFamily) => patchCoverText({ captionFontFamily })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="cover-caption-font-size">{t('banner.fontSize')}</label>
              <FontSizeSelect
                id="cover-caption-font-size"
                value={style.coverText.captionFontSize ?? ''}
                sizes={FONT_SIZE_OPTIONS}
                onChange={(captionFontSize) => patchCoverText({ captionFontSize })}
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="cover-description">{t('banner.description')}</label>
            <textarea
              id="cover-description"
              value={style.coverText.description ?? ''}
              onChange={(e) => patchCoverText({ description: e.target.value })}
              rows={4}
              maxLength={2000}
            />
          </div>

          <div className="ae-row">
            <div className="form-group">
              <span className="ae-duration-label">{t('banner.descriptionAlignment')}</span>
              <AlignmentPicker
                name="cover-description-alignment"
                value={style.coverText.descriptionAlignment ?? 'center'}
                label={t('banner.descriptionAlignment')}
                onChange={(descriptionAlignment) => patchCoverText({ descriptionAlignment })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="cover-description-color">{t('banner.fontColor')}</label>
              <input
                id="cover-description-color"
                type="color"
                value={style.coverText.descriptionFontColor || '#ffffff'}
                onChange={(e) => patchCoverText({ descriptionFontColor: e.target.value })}
              />
            </div>
          </div>

          <div className="ae-row">
            <div className="form-group">
              <label htmlFor="cover-description-font-family">{t('banner.fontStyle')}</label>
              <FontStyleSelect
                id="cover-description-font-family"
                value={style.coverText.descriptionFontFamily ?? ''}
                onChange={(descriptionFontFamily) => patchCoverText({ descriptionFontFamily })}
              />
            </div>
            <div className="form-group">
              <label htmlFor="cover-description-font-size">{t('banner.fontSize')}</label>
              <FontSizeSelect
                id="cover-description-font-size"
                value={style.coverText.descriptionFontSize ?? ''}
                sizes={DESCRIPTION_FONT_SIZE_OPTIONS}
                onChange={(descriptionFontSize) => patchCoverText({ descriptionFontSize })}
              />
            </div>
          </div>

          <div className="form-group">
            <span className="ae-duration-label">{t('banner.verticalAlignment')}</span>
            <VerticalAlignmentPicker
              name="cover-vertical"
              value={style.coverText.verticalAlignment ?? 'center'}
              label={t('banner.verticalAlignment')}
              onChange={(verticalAlignment) => patchCoverText({ verticalAlignment })}
            />
          </div>
        </section>

        <section id="ae-elements" className="ae-card">
          <h2>Page Elements &amp; Layout</h2>
          <p className="ae-hint">
            Reorder elements, toggle them on or off, and set any element to span the full width or
            sit side-by-side with its neighbour.
          </p>

          <div className="ae-layout-list">
            {layout.map((el, index) => (
              <div key={el.id} className={`ae-layout-item span-${el.span}`}>
                <span className="ae-layout-label">{ELEMENT_LABELS[el.type]}</span>
                <div className="ae-layout-controls">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => moveElement(index, -1)}
                    disabled={index === 0}
                    aria-label="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => moveElement(index, 1)}
                    disabled={index === layout.length - 1}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => toggleSpan(el.type)}
                  >
                    {el.span === 2 ? 'Full width' : 'Side by side'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => toggleElement(el.type)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>

          <h3 className="ae-subheading">{t('editor.addElements')}</h3>
          <div className="ae-add-elements">
            {ELEMENT_TYPES.filter((t) => !layout.some((l) => l.type === t)).map((t) => (
              <button
                key={t}
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => toggleElement(t)}
              >
                + {ELEMENT_LABELS[t]}
              </button>
            ))}
          </div>
        </section>

        {isEdit && event && (
          <section id="ae-lists" className="ae-card">
            <h2>{t('editor.participantLists')}</h2>
            <p className="ae-hint">
              Every event keeps at least one list. Main List and Waitlist are created automatically.
            </p>
            <EventRegistrationMenu event={event} users={users} />
          </section>
        )}

        {message && <div className="ae-message">{message}</div>}

        {/* The panel pinned to the bottom while the form scrolls: the
            history steps sit beside the save button. */}
        <div className="ae-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={undo}
            disabled={!canUndo || saving}
            title={
              canUndo
                ? t('editor.historyNextUndo', {
                    label: stepLabel(past[past.length - 1].label),
                  })
                : t('editor.undo')
            }
            aria-label={t('editor.undo')}
          >
            <span aria-hidden="true">↶</span> {t('editor.undo')}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={redo}
            disabled={!canRedo || saving}
            title={
              canRedo
                ? t('editor.historyNextRedo', { label: stepLabel(future[0].label) })
                : t('editor.redo')
            }
            aria-label={t('editor.redo')}
          >
            <span aria-hidden="true">↷</span> {t('editor.redo')}
          </button>
          <button type="submit" className="btn btn-primary btn-lg" disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Event'}
          </button>
        </div>
      </form>

      {/* Page navigation. The toolbox is only implemented where a page
          fits it, so nothing else in the app shows one; here it is
          measured against the save panel and sits above it. */}
      <ToolboxNav
        sections={[
          { id: 'ae-templates', icon: '📋', label: t('editor.sectionTemplates') },
          { id: 'ae-details', icon: '📝', label: t('editor.sectionDetails') },
          { id: 'ae-visibility', icon: '👁️', label: t('editor.sectionVisibility') },
          { id: 'ae-styling', icon: '🎨', label: t('editor.sectionStyling') },
          { id: 'ae-cover-text', icon: '🖼️', label: t('editor.sectionCoverText') },
          { id: 'ae-elements', icon: '🧩', label: t('editor.sectionElements') },
          // The lists section exists only once the event does.
          ...(isEdit && event
            ? [{ id: 'ae-lists', icon: '👥', label: t('editor.sectionLists') }]
            : []),
        ]}
        avoid=".ae-actions"
        // The editor's own bar sticks under the site header, so a jump
        // has to stop below that too.
        stickySelectors={['.ae-header']}
      />
    </div>
  )
}

