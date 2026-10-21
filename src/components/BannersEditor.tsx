import { useEffect, useMemo, useRef, useState } from 'react'
import { bannersAPI, uploadAPI, apiErrorMessage, resolveAssetUrl } from '../utils/api'
import type {
  BannerAd,
  BannerAdType,
  BannerAnnouncementConfig,
  BannerConfig,
  BannerContactItem,
  BannerContactsConfig,
  BannerCoverConfig,
  BannerCounterConfig,
  BannerPollConfig,
  BannerPollOption,
  BannerPollVoter,
  BannerSlot,
  BannerSlotName,
  BannerTemplate,
} from '../types'
import './BannersEditor.css'
import './RichTextEditor.css'
import { EMOJI_GROUPS } from './RichTextEditor'
import BannerAdView from './BannerAdView'
import { useI18n } from '../i18n'
import {
  ALIGNMENTS,
  DESCRIPTION_FONT_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  AlignmentPicker,
  FontSizeSelect,
  FontStyleSelect,
  VerticalAlignmentPicker,
} from './TextStyleControls'

const BANNER_TYPES: BannerAdType[] = [
  'COVER',
  'COUNTER',
  'POLL',
  'CONTACTS',
  'ANNOUNCEMENT',
]

const newOptionId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `opt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const newOption = (text = ''): BannerPollOption => ({
  id: newOptionId(),
  text,
  votes: 0,
})

/** Fresh settings for each ad type, so switching type starts clean. */
const defaultConfig = (type: BannerAdType): BannerConfig => {
  switch (type) {
    case 'COVER':
      return {
        backgroundType: 'gradient',
        gradientFrom: '#3b82f6',
        gradientTo: '#8b5cf6',
        text: '',
        alignment: 'center',
        fontColor: '#ffffff',
        description: '',
        descriptionAlignment: 'center',
        descriptionFontColor: '#ffffff',
        verticalAlignment: 'center',
      }
    case 'COUNTER':
      return {
        current: 0,
        target: 100,
        style: 'bar',
        valueDisplay: 'percent',
        label: '',
        caption: '',
        details: '',
        currency: '$',
      }
    case 'POLL':
      return { question: '', options: [newOption(), newOption()] }
    case 'CONTACTS':
      return {
        placement: 'bottom',
        alignment: 'center',
        buttonStyle: 'filled',
        contacts: [{ platform: 'whatsapp', value: '', label: 'WhatsApp' }],
      }
    case 'ANNOUNCEMENT':
      return {
        text: '',
        alignment: 'center',
        fontColor: '#ffffff',
        backgroundType: 'color',
        backgroundColor: '#3b82f6',
      }
  }
}

/** One-line summary of an ad's settings, for the slot's ad list. */
function summarizeAd(ad: BannerAd): string {
  const config = (ad.config ?? {}) as BannerConfig
  switch (ad.type) {
    case 'COVER': {
      const c = config as BannerCoverConfig
      return c.text || c.imageUrl || c.backgroundType
    }
    case 'COUNTER': {
      const c = config as BannerCounterConfig
      return c.caption || `${c.current} / ${c.target}`
    }
    case 'POLL': {
      const c = config as BannerPollConfig
      const total = c.options.reduce((sum, o) => sum + o.votes, 0)
      return c.question || `${c.options.length} options · ${total} votes`
    }
    case 'CONTACTS': {
      const c = config as BannerContactsConfig
      return `${c.contacts.length} contact(s)`
    }
    case 'ANNOUNCEMENT': {
      const c = config as { text?: string }
      return c.text || ''
    }
  }
}

/**
 * The ad being edited, lifted out of the form so the template library
 * beside it can save the draft away and apply a saved one to it.
 */
interface BannerDraft {
  slotId: string
  /** The ad being changed, or nothing for a new one. */
  adId?: string
  type: BannerAdType
  config: BannerConfig
  duration: number
  isActive: boolean
}

const SLOT_TABS: BannerSlotName[] = ['LEFT', 'MAIN', 'RIGHT']

const slotName = (slot: BannerSlotName): 'banner.slotLeft' | 'banner.slotMain' | 'banner.slotRight' =>
  slot === 'LEFT' ? 'banner.slotLeft' : slot === 'MAIN' ? 'banner.slotMain' : 'banner.slotRight'

export default function BannersEditor() {
  const { t } = useI18n()
  const [slots, setSlots] = useState<BannerSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  /** Which of the three banners the panel is showing. */
  const [activeSlot, setActiveSlot] = useState<BannerSlotName>('MAIN')
  /** The ad the controls below the preview act on. */
  const [selectedAdId, setSelectedAdId] = useState<string | null>(null)
  /** The ad being edited, or null when nothing is open. */
  const [draft, setDraft] = useState<BannerDraft | null>(null)
  const [saving, setSaving] = useState(false)
  /** The template library's own saved configurations. */
  const [templates, setTemplates] = useState<BannerTemplate[]>([])
  const [templateName, setTemplateName] = useState('')
  const [templateBusy, setTemplateBusy] = useState(false)

  const load = async () => {
    try {
      const r = await bannersAPI.adminList()
      setSlots(r.data.slots)
      setError('')
    } catch (err) {
      setError(apiErrorMessage(err, t('banner.loadFailed')))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // The library is shared by every ad of the tab, so it is loaded once for
  // the panel rather than per form.
  useEffect(() => {
    let cancelled = false
    bannersAPI
      .templates()
      .then((r) => {
        if (!cancelled) setTemplates(r.data.templates)
      })
      .catch(() => {
        // Without templates the library simply has none to show.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const updateSlot = (updated: BannerSlot) =>
    setSlots((list) => list.map((s) => (s.id === updated.id ? updated : s)))

  const handleSlotSetting = async (
    slot: BannerSlot,
    patch: { interval?: number; isActive?: boolean; logChanges?: boolean }
  ) => {
    try {
      const r = await bannersAPI.updateSlot(slot.slot, patch)
      updateSlot({ ...slot, ...r.data.slot })
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banner.saveFailed')))
    }
  }

  const handleDelete = async (ad: BannerAd) => {
    if (!window.confirm(t('banner.deleteConfirm'))) return
    try {
      await bannersAPI.remove(ad.id)
      if (draft?.adId === ad.id) setDraft(null)
      if (selectedAdId === ad.id) setSelectedAdId(null)
      await load()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banner.deleteFailed')))
    }
  }

  const handleReorder = async (slot: BannerSlot, index: number, dir: -1 | 1) => {
    const ads = [...(slot.ads ?? [])]
    const target = index + dir
    if (target < 0 || target >= ads.length) return
    ;[ads[index], ads[target]] = [ads[target], ads[index]]
    try {
      const r = await bannersAPI.reorder(
        slot.id,
        ads.map((a) => a.id)
      )
      updateSlot({ ...slot, ads: r.data.ads })
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banner.saveFailed')))
    }
  }

  /** Opens an ad for editing: an existing one, or a blank of the given type. */
  const openDraft = (slotId: string, ad?: BannerAd, type?: BannerAdType) => {
    setDraft({
      slotId,
      adId: ad?.id,
      type: ad?.type ?? type ?? 'COVER',
      config: ad?.config ?? defaultConfig(type ?? 'COVER'),
      duration: ad?.duration ?? 5,
      isActive: ad?.isActive ?? true,
    })
  }

  const patchDraft = (patch: Partial<BannerDraft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current))

  const submitDraft = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const payload = {
        slotId: draft.slotId,
        type: draft.type,
        config: draft.config,
        duration: draft.duration,
        isActive: draft.isActive,
      }
      if (draft.adId) {
        await bannersAPI.update(draft.adId, payload)
      } else {
        await bannersAPI.create(payload)
      }
      setDraft(null)
      setSelectedAdId(null)
      await load()
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banner.saveFailed')))
    } finally {
      setSaving(false)
    }
  }

  /** Only templates of the type being configured apply. */
  const compatibleTemplates = draft
    ? templates.filter((template) => template.type === draft.type)
    : []

  const saveTemplate = async () => {
    const name = templateName.trim()
    if (!name || !draft || templateBusy) return
    setTemplateBusy(true)
    try {
      const r = await bannersAPI.saveTemplate({ name, type: draft.type, config: draft.config })
      setTemplates((list) => [r.data.template, ...list])
      setTemplateName('')
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banner.templateSaveFailed')))
    } finally {
      setTemplateBusy(false)
    }
  }

  const deleteTemplate = async (id: string) => {
    if (!window.confirm(t('banner.deleteTemplateConfirm'))) return
    try {
      await bannersAPI.deleteTemplate(id)
      setTemplates((list) => list.filter((template) => template.id !== id))
    } catch (err) {
      window.alert(apiErrorMessage(err, t('banner.templateDeleteFailed')))
    }
   }
   
   if (loading) {
    return (
      <div className="admin-section">
        <div className="home-loading">
          <div className="spinner" />
        </div>
      </div>
    )
  }

  const slot = slots.find((s) => s.slot === activeSlot) ?? null
  const ads = slot?.ads ?? []
  const selectedAd = ads.find((a) => a.id === selectedAdId) ?? null
  const selectedIndex = selectedAd ? ads.findIndex((a) => a.id === selectedAd.id) : -1

  return (
    <div className="admin-section banners-editor">
      <h2>{t('admin.tabBanners')}</h2>
      <p className="admin-hint">{t('banner.hint')}</p>

      {error && <p className="tag-error">{error}</p>}

      {/* The three banners, one tab each. */}
      <div className="banner-tabs" role="tablist" aria-label={t('admin.tabBanners')}>
        {SLOT_TABS.map((name) => {
          const target = slots.find((s) => s.slot === name)
          const count = (target?.ads ?? []).length
          return (
            <button
              key={name}
              type="button"
              role="tab"
              id={`banner-tab-${name}`}
              aria-selected={activeSlot === name}
              aria-controls="banner-slot-panel"
              className={`banner-tab${activeSlot === name ? ' is-active' : ''}`}
              onClick={() => {
                setActiveSlot(name)
                setSelectedAdId(null)
                setDraft(null)
              }}
            >
              {t(slotName(name))}
              {count > 0 && <span className="banner-tab-count">{count}</span>}
            </button>
          )
        })}
      </div>

      {slot && (
        <section
          id="banner-slot-panel"
          role="tabpanel"
          aria-labelledby={`banner-tab-${slot.slot}`}
          className="banner-slot-card"
        >
          {/* The banner as it appears, straight under the tabs. On the main
              banner each ad is a button: clicking one makes it the ad the
              controls below act on and the one the form edits. */}
          <div className="banner-preview">
            {ads.length === 0 ? (
              <p className="banner-preview-empty">{t('banner.noAds')}</p>
            ) : (
              <div
                className={`banner-preview-grid${
                  slot.slot === 'MAIN' ? ' is-selectable' : ''
                }`}
              >
                {ads.map((ad, index) => (
                  <div
                    key={ad.id}
                    role="button"
                    tabIndex={0}
                    className={`banner-preview-item${
                      selectedAdId === ad.id ? ' is-selected' : ''
                    }`}
                    onClick={() => {
                      setSelectedAdId(ad.id)
                      openDraft(slot.id, ad)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedAdId(ad.id)
                        openDraft(slot.id, ad)
                      }
                    }}
                    aria-pressed={selectedAdId === ad.id}
                    title={t('banner.selectAd')}
                  >
                    {/* The preview shows the ad as the page renders it, and
                        answers no clicks of its own. */}
                    <span className="banner-preview-surface">
                      <BannerAdView ad={ad} />
                    </span>
                    <span className="banner-preview-tag">
                      {t(`banner.type${ad.type.charAt(0)}${ad.type.slice(1).toLowerCase()}` as 'banner.typeCover')}
                      {!ad.isActive && ` · ${t('banner.inactive')}`}
                      {slot.slot === 'MAIN' && ` · ${index + 1}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reordering, adding and deleting, in one row under the preview. */}
          <div className="banner-controls">
            <div className="banner-reorder">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void handleReorder(slot, selectedIndex, -1)}
                disabled={selectedIndex <= 0}
                aria-label={t('banner.moveEarlier')}
                title={t('banner.moveEarlier')}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void handleReorder(slot, selectedIndex, 1)}
                disabled={selectedIndex === -1 || selectedIndex === ads.length - 1}
                aria-label={t('banner.moveLater')}
                title={t('banner.moveLater')}
              >
                ↓
              </button>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => openDraft(slot.id)}
              disabled={slot.slot !== 'MAIN' && ads.length > 0}
              title={
                slot.slot !== 'MAIN' && ads.length > 0 ? t('banner.singleAdHint') : undefined
              }
            >
              {t('banner.addAd')}
            </button>
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => selectedAd && void handleDelete(selectedAd)}
              disabled={!selectedAd}
            >
              {t('banner.delete')}
            </button>
          </div>

          {/* The banner's own settings, in one row. */}
          <div className="banner-toggles">
            <label className="banner-slot-toggle">
              <input
                type="checkbox"
                checked={slot.isActive}
                onChange={(e) => void handleSlotSetting(slot, { isActive: e.target.checked })}
              />
              <span>{t('banner.enabled')}</span>
            </label>
            <label className="banner-slot-toggle" title={t('banner.logChangesHint')}>
              <input
                type="checkbox"
                checked={slot.logChanges ?? true}
                onChange={(e) => void handleSlotSetting(slot, { logChanges: e.target.checked })}
              />
              <span>{t('banner.logChanges')}</span>
            </label>
            {slot.slot === 'MAIN' && (
              <label className="banner-interval">
                <span>{t('banner.interval')}</span>
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={slot.interval}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (Number.isFinite(n) && n >= 2 && n <= 60) {
                      void handleSlotSetting(slot, { interval: n })
                    }
                  }}
                />
              </label>
            )}
          </div>

          <p className="admin-hint">
            {slot.slot === 'MAIN' ? t('banner.mainHint') : t('banner.sideHint')}
          </p>

          {/* The template library and the ad being modified. */}
          <div className="banner-library-row">
            <div className="banner-template-library">
              <span className="ae-duration-label">{t('banner.templateLibrary')}</span>
              <div className="banner-template-save">
                <input
                  type="text"
                  value={templateName}
                  placeholder={t('banner.templateName')}
                  aria-label={t('banner.templateName')}
                  onChange={(e) => setTemplateName(e.target.value)}
                  maxLength={80}
                  disabled={!draft}
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => void saveTemplate()}
                  disabled={templateBusy || !draft || !templateName.trim()}
                >
                  {templateBusy ? t('banner.saving') : t('banner.saveTemplate')}
                </button>
              </div>
              {compatibleTemplates.length > 0 ? (
                <ul className="banner-template-list">
                  {compatibleTemplates.map((template) => (
                    <li key={template.id} className="banner-template-row">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() =>
                          patchDraft({ type: template.type, config: template.config })
                        }
                        title={t('banner.loadTemplate')}
                      >
                        {template.name}
                      </button>
                      <span className="banner-ad-type">
                        {t(
                          `banner.type${template.type.charAt(0)}${template.type.slice(1).toLowerCase()}` as 'banner.typeCover'
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void deleteTemplate(template.id)}
                        aria-label={t('banner.deleteTemplate')}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ae-hint">{t('banner.noTemplates')}</p>
              )}
            </div>
          </div>

          {/* The ad being modified. */}
          {draft && (
            <BannerAdForm draft={draft} onChange={patchDraft} />
          )}
        </section>
      )}

      {/* Saving and cancelling live in a panel pinned to the bottom. */}
      {draft && (
        <div className="banner-actions-pinned">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => void submitDraft()}
            disabled={saving}
          >
            {saving ? t('banner.saving') : t('banner.save')}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={() => setDraft(null)}
            disabled={saving}
          >
            {t('banner.cancel')}
          </button>
        </div>
      )}
    </div>
  )
}

/* ---------------------------------- form ---------------------------------- */

/**
 * The ad being modified. It is a view over the draft the panel holds, so
 * the template library beside it can read and replace what is being worked
 * on, and so saving and cancelling belong to the panel's pinned footer
 * rather than to the form.
 */
function BannerAdForm({
  draft,
  onChange,
}: {
  draft: BannerDraft
  onChange: (patch: Partial<BannerDraft>) => void
}) {
  const { t } = useI18n()
  const { type, config, duration, isActive, adId } = draft
  const editing = Boolean(adId)

  const changeType = (next: BannerAdType) => {
    onChange({ type: next, config: defaultConfig(next) })
  }

  // The typed field panels hand back a complete config for their type, so they
  // are slotted straight onto the draft that the template library and the
  // panel's pinned footer act on.
  const setConfig = (c: BannerConfig) => onChange({ config: c })
  const setDuration = (d: number) => onChange({ duration: d })

  return (
    <form id="banner-ad-form" className="banner-ad-form" onSubmit={(e) => e.preventDefault()}>
      <h3>{editing ? t('banner.editAd') : t('banner.newAd')}</h3>

      <div className="form-group">
        <label htmlFor="banner-type">{t('banner.type')}</label>
        <select
          id="banner-type"
          value={type}
          onChange={(e) => changeType(e.target.value as BannerAdType)}
          disabled={editing}
        >
          {BANNER_TYPES.map(
            (bannerType) => (
              <option key={bannerType} value={bannerType}>
                {t(`banner.type${bannerType.charAt(0)}${bannerType.slice(1).toLowerCase()}` as 'banner.typeCover')}
              </option>
            )
          )}
        </select>
        {editing && (
          <p className="ae-hint">{t('banner.typeLockedHint')}</p>
        )}
      </div>

      {type === 'COVER' && (
        <CoverFields config={config as BannerCoverConfig} onChange={setConfig} />
      )}
      {type === 'COUNTER' && (
        <CounterFields config={config as BannerCounterConfig} onChange={setConfig} />
      )}
      {type === 'POLL' && (
        <PollFields config={config as BannerPollConfig} onChange={setConfig} adId={adId} />
      )}
      {type === 'CONTACTS' && (
        <ContactsFields config={config as BannerContactsConfig} onChange={setConfig} />
      )}
      {type === 'ANNOUNCEMENT' && (
        <AnnouncementFields
          config={config as BannerAnnouncementConfig}
          onChange={setConfig}
          duration={duration}
          onDuration={setDuration}
        />
      )}

      <div className="form-group banner-active-row">
        <label className="banner-slot-toggle">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => onChange({ isActive: e.target.checked })}
          />
          <span>{t('banner.active')}</span>
        </label>
      </div>
    </form>
  )
}

/* ------------------------------ type fields ------------------------------- */

/**
 * Caption, detailed description and background, mirroring the event page's
 * text settings: each of the two texts has its own style and alignment row,
 * and the vertical alignment decides where the block sits in the banner.
 */
function CoverFields({
  config,
  onChange,
}: {
  config: BannerCoverConfig
  onChange: (c: BannerCoverConfig) => void
}) {
  const { t } = useI18n()
  return (
    <>
      <div className="form-group">
        <label htmlFor="banner-cover-text">{t('banner.caption')}</label>
        <input
          id="banner-cover-text"
          value={config.text ?? ''}
          onChange={(e) => onChange({ ...config, text: e.target.value })}
          maxLength={500}
        />
      </div>

      <div className="ae-row">
        <div className="form-group">
          <span className="ae-duration-label">{t('banner.alignment')}</span>
          <AlignmentPicker
            name="banner-cover-alignment"
            value={config.alignment ?? 'center'}
            label={t('banner.alignment')}
            onChange={(alignment) => onChange({ ...config, alignment })}
          />
        </div>
        <div className="form-group">
          <label htmlFor="banner-cover-font">{t('banner.fontColor')}</label>
          <input
            id="banner-cover-font"
            type="color"
            value={config.fontColor || '#ffffff'}
            onChange={(e) => onChange({ ...config, fontColor: e.target.value })}
          />
        </div>
      </div>

      <div className="ae-row">
        <div className="form-group">
          <label htmlFor="banner-cover-font-family">{t('banner.fontStyle')}</label>
          <FontStyleSelect
            id="banner-cover-font-family"
            value={config.fontFamily ?? ''}
            onChange={(fontFamily) => onChange({ ...config, fontFamily })}
          />
        </div>
        <div className="form-group">
          <label htmlFor="banner-cover-font-size">{t('banner.fontSize')}</label>
          <FontSizeSelect
            id="banner-cover-font-size"
            value={config.fontSize ?? ''}
            sizes={FONT_SIZE_OPTIONS}
            onChange={(fontSize) => onChange({ ...config, fontSize })}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="banner-cover-description">{t('banner.description')}</label>
        <textarea
          id="banner-cover-description"
          value={config.description ?? ''}
          onChange={(e) => onChange({ ...config, description: e.target.value })}
          rows={4}
          maxLength={2000}
        />
        <p className="ae-hint">{t('banner.descriptionHint')}</p>
      </div>

      <div className="ae-row">
        <div className="form-group">
          <span className="ae-duration-label">{t('banner.descriptionAlignment')}</span>
          <AlignmentPicker
            name="banner-cover-description-alignment"
            value={config.descriptionAlignment ?? 'center'}
            label={t('banner.descriptionAlignment')}
            onChange={(descriptionAlignment) =>
              onChange({ ...config, descriptionAlignment })
            }
          />
        </div>
        <div className="form-group">
          <label htmlFor="banner-cover-description-font">{t('banner.fontColor')}</label>
          <input
            id="banner-cover-description-font"
            type="color"
            value={config.descriptionFontColor || '#ffffff'}
            onChange={(e) => onChange({ ...config, descriptionFontColor: e.target.value })}
          />
        </div>
      </div>

      <div className="ae-row">
        <div className="form-group">
          <label htmlFor="banner-cover-description-font-family">{t('banner.fontStyle')}</label>
          <FontStyleSelect
            id="banner-cover-description-font-family"
            value={config.descriptionFontFamily ?? ''}
            onChange={(descriptionFontFamily) =>
              onChange({ ...config, descriptionFontFamily })
            }
          />
        </div>
        <div className="form-group">
          <label htmlFor="banner-cover-description-font-size">{t('banner.fontSize')}</label>
          <FontSizeSelect
            id="banner-cover-description-font-size"
            value={config.descriptionFontSize ?? ''}
            sizes={DESCRIPTION_FONT_SIZE_OPTIONS}
            onChange={(descriptionFontSize) => onChange({ ...config, descriptionFontSize })}
          />
        </div>
      </div>

      <div className="form-group">
        <span className="ae-duration-label">{t('banner.verticalAlignment')}</span>
        <VerticalAlignmentPicker
          name="banner-cover-vertical"
          value={config.verticalAlignment ?? 'center'}
          label={t('banner.verticalAlignment')}
          onChange={(verticalAlignment) => onChange({ ...config, verticalAlignment })}
        />
      </div>

      <div className="form-group">
        <span className="ae-duration-label">{t('banner.backgroundType')}</span>
        <div className="tag-visibility-modes" role="radiogroup" aria-label={t('banner.backgroundType')}>
          {(
            [
              ['image', t('banner.backgroundImage')],
              ['color', t('banner.backgroundSolid')],
              ['gradient', t('banner.backgroundGradient')],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`tag-mode ${config.backgroundType === value ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="banner-background"
                checked={config.backgroundType === value}
                onChange={() => onChange({ ...config, backgroundType: value })}
              />
              <span className="tag-mode-text">
                <strong>{label}</strong>
              </span>
            </label>
          ))}
        </div>
      </div>

      {config.backgroundType === 'image' && (
        <div className="form-group">
          <label>{t('banner.image')}</label>
          <BannerImageField
            value={config.imageUrl ?? ''}
            onChange={(url) => onChange({ ...config, imageUrl: url })}
          />
        </div>
      )}

      {config.backgroundType === 'color' && (
        <div className="ae-row">
          <div className="form-group">
            <label htmlFor="banner-cover-color">{t('banner.backgroundColor')}</label>
            <input
              id="banner-cover-color"
              type="color"
              value={config.color || '#3b82f6'}
              onChange={(e) => onChange({ ...config, color: e.target.value })}
            />
          </div>
        </div>
      )}

      {config.backgroundType === 'gradient' && (
        <div className="ae-row">
          <div className="form-group">
            <label htmlFor="banner-gradient-from">{t('banner.gradientFrom')}</label>
            <input
              id="banner-gradient-from"
              type="color"
              value={config.gradientFrom || '#3b82f6'}
              onChange={(e) => onChange({ ...config, gradientFrom: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="banner-gradient-to">{t('banner.gradientTo')}</label>
            <input
              id="banner-gradient-to"
              type="color"
              value={config.gradientTo || '#8b5cf6'}
              onChange={(e) => onChange({ ...config, gradientTo: e.target.value })}
            />
          </div>
        </div>
      )}
    </>
  )
}

/** Image URL with an upload button and thumbnail, like the event's images. */
function BannerImageField({
  value,
  onChange,
}: {
  value: string
  onChange: (url: string) => void
}) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const upload = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('cover', file)
      const r = await uploadAPI.uploadCover(fd)
      onChange(r.data.url)
    } catch {
      setError(t('banner.uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="banner-image-field">
      <div className="cover-images-fields">
        <input
          type="text"
          value={value}
          placeholder={t('banner.imageUrl')}
          aria-label={t('banner.imageUrl')}
          onChange={(e) => onChange(e.target.value)}
        />
        <label className="btn btn-secondary btn-sm">
          {busy ? t('banner.uploading') : t('banner.upload')}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) upload(file)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      <div className="cover-images-thumb">
        {value ? (
          <img src={resolveAssetUrl(value)} alt={t('banner.imagePreview')} loading="lazy" />
        ) : (
          <span className="cover-images-thumb-empty">{t('banner.imageNoImage')}</span>
        )}
      </div>
      {error && <p className="cover-images-error">{error}</p>}
    </div>
  )
}

function CounterFields({
  config,
  onChange,
}: {
  config: BannerCounterConfig
  onChange: (c: BannerCounterConfig) => void
}) {
  const { t } = useI18n()
  const [step, setStep] = useState(1)

  const adjust = (
    field: 'current' | 'target',
    delta: number
  ) => {
    const value = config[field] + delta
    onChange({
      ...config,
      [field]:
        field === 'current' ? Math.max(0, value) : Math.max(1, value),
    })
  }

  return (
    <>
      <div className="ae-row">
        <div className="form-group">
          <label htmlFor="banner-counter-current">{t('banner.current')}</label>
          <div className="banner-counter-adjust">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => adjust('current', -step)}
              aria-label={t('banner.decrease')}
            >
              −
            </button>
            <input
              id="banner-counter-current"
              type="number"
              min={0}
              value={config.current}
              onChange={(e) =>
                onChange({ ...config, current: Number(e.target.value) || 0 })
              }
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => adjust('current', step)}
              aria-label={t('banner.increase')}
            >
              +
            </button>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="banner-counter-target">{t('banner.target')}</label>
          <div className="banner-counter-adjust">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => adjust('target', -step)}
              aria-label={t('banner.decrease')}
            >
              −
            </button>
            <input
              id="banner-counter-target"
              type="number"
              min={1}
              value={config.target}
              onChange={(e) =>
                onChange({ ...config, target: Math.max(1, Number(e.target.value) || 1) })
              }
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => adjust('target', step)}
              aria-label={t('banner.increase')}
            >
              +
            </button>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="banner-counter-currency">{t('banner.currency')}</label>
          <select
            id="banner-counter-currency"
            value={config.currency ?? '$'}
            onChange={(e) => onChange({ ...config, currency: e.target.value })}
          >
            {['$', '₽', '€', '🪙'].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="banner-counter-step">{t('banner.step')}</label>
          <select
            id="banner-counter-step"
            value={step}
            onChange={(e) => setStep(Number(e.target.value))}
          >
            {[1, 10, 100, 1000].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="form-group">
        <span className="ae-duration-label">{t('banner.counterStyle')}</span>
        <div className="tag-visibility-modes" role="radiogroup" aria-label={t('banner.counterStyle')}>
          {(
            [
              ['bar', t('banner.styleBar')],
              ['circle', t('banner.styleCircle')],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`tag-mode ${config.style === value ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="banner-counter-style"
                checked={config.style === value}
                onChange={() => onChange({ ...config, style: value })}
              />
              <span className="tag-mode-text">
                <strong>{label}</strong>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="banner-counter-caption">{t('banner.caption')}</label>
        <input
          id="banner-counter-caption"
          value={config.caption ?? ''}
          onChange={(e) => onChange({ ...config, caption: e.target.value })}
          maxLength={200}
        />
        <p className="ae-hint">{t('banner.counterCaptionHint')}</p>
      </div>

      <div className="form-group">
        <label htmlFor="banner-counter-label">{t('banner.counterLabel')}</label>
        <input
          id="banner-counter-label"
          value={config.label ?? ''}
          onChange={(e) => onChange({ ...config, label: e.target.value })}
          maxLength={200}
        />
        <p className="ae-hint">{t('banner.counterLabelHint')}</p>
      </div>

      <div className="form-group">
        <span className="ae-duration-label">{t('banner.valueDisplay')}</span>
        <div className="tag-visibility-modes" role="radiogroup" aria-label={t('banner.valueDisplay')}>
          {(
            [
              ['percent', t('banner.valuePercent')],
              ['current', t('banner.valueCurrent')],
              ['target', t('banner.valueTarget')],
              ['raw', t('banner.valueRaw')],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`tag-mode ${(config.valueDisplay ?? 'percent') === value ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="banner-counter-value-display"
                checked={(config.valueDisplay ?? 'percent') === value}
                onChange={() => onChange({ ...config, valueDisplay: value })}
              />
              <span className="tag-mode-text">
                <strong>{label}</strong>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="form-group">
        <span className="ae-duration-label">{t('banner.backgroundType')}</span>
        <div className="tag-visibility-modes" role="radiogroup" aria-label={t('banner.backgroundType')}>
          {(
            [
              ['color', t('banner.backgroundSolid')],
              ['gradient', t('banner.backgroundGradient')],
              ['image', t('banner.backgroundImage')],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`tag-mode ${config.backgroundType === value ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="banner-counter-background"
                checked={config.backgroundType === value}
                onChange={() => onChange({ ...config, backgroundType: value })}
              />
              <span className="tag-mode-text">
                <strong>{label}</strong>
              </span>
            </label>
          ))}
        </div>
      </div>

      {config.backgroundType === 'color' && (
        <div className="ae-row">
          <div className="form-group">
            <label htmlFor="banner-counter-bg-color">{t('banner.backgroundColor')}</label>
            <input
              id="banner-counter-bg-color"
              type="color"
              value={config.color || '#3b82f6'}
              onChange={(e) => onChange({ ...config, color: e.target.value })}
            />
          </div>
        </div>
      )}

      {config.backgroundType === 'gradient' && (
        <div className="ae-row">
          <div className="form-group">
            <label htmlFor="banner-counter-gradient-from">{t('banner.gradientFrom')}</label>
            <input
              id="banner-counter-gradient-from"
              type="color"
              value={config.gradientFrom || '#3b82f6'}
              onChange={(e) => onChange({ ...config, gradientFrom: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="banner-counter-gradient-to">{t('banner.gradientTo')}</label>
            <input
              id="banner-counter-gradient-to"
              type="color"
              value={config.gradientTo || '#8b5cf6'}
              onChange={(e) => onChange({ ...config, gradientTo: e.target.value })}
            />
          </div>
        </div>
      )}

      {config.backgroundType === 'image' && (
        <div className="form-group">
          <label>{t('banner.image')}</label>
          <BannerImageField
            value={config.imageUrl ?? ''}
            onChange={(url) => onChange({ ...config, imageUrl: url })}
          />
        </div>
      )}

      <div className="form-group">
        <label htmlFor="banner-counter-details">{t('banner.details')}</label>
        <textarea
          id="banner-counter-details"
          value={config.details ?? ''}
          onChange={(e) => onChange({ ...config, details: e.target.value })}
          rows={3}
          maxLength={2000}
        />
        <p className="ae-hint">{t('banner.counterDetailsHint')}</p>
      </div>
    </>
  )
}

function PollFields({
  config,
  onChange,
  adId,
}: {
  config: BannerPollConfig
  onChange: (c: BannerPollConfig) => void
  /** Set when editing an existing poll, to load its voters. */
  adId?: string
}) {
  const { t } = useI18n()
  const [voters, setVoters] = useState<BannerPollVoter[]>([])

  // Who voted for what, so the editor can show the people
  // behind every option's count.
  useEffect(() => {
    if (!adId) {
      setVoters([])
      return
    }
    let cancelled = false
    bannersAPI
      .voters(adId)
      .then((r) => {
        if (!cancelled) setVoters(r.data.voters)
      })
      .catch(() => {
        // Without voter data the editor simply shows the counts.
      })
    return () => {
      cancelled = true
    }
  }, [adId])

  const votersByOption = useMemo(() => {
    const grouped: Record<string, BannerPollVoter[]> = {}
    for (const voter of voters) {
      ;(grouped[voter.optionId] ??= []).push(voter)
    }
    return grouped
  }, [voters])

  const totalVotes = config.options.reduce((sum, o) => sum + o.votes, 0)

  const setOptionText = (index: number, text: string) => {
    const options = config.options.map((o, i) =>
      i === index ? { ...o, text } : o
    )
    onChange({ ...config, options })
  }

  const removeOption = (index: number) => {
    if (config.options.length <= 2) return
    onChange({
      ...config,
      options: config.options.filter((_, i) => i !== index),
    })
  }

  const addOption = () => {
    if (config.options.length >= 10) return
    onChange({ ...config, options: [...config.options, newOption()] })
  }

  return (
    <>
      <div className="form-group">
        <label htmlFor="banner-poll-question">{t('banner.question')}</label>
        <input
          id="banner-poll-question"
          value={config.question ?? ''}
          onChange={(e) => onChange({ ...config, question: e.target.value })}
          maxLength={300}
        />
      </div>

      <div className="form-group">
        <label>{t('banner.options')}</label>
        <p className="ae-hint">{t('banner.votersHint')}</p>
        <div className="banner-poll-options">
          {config.options.map((option, index) => {
            const optionVoters = votersByOption[option.id] ?? []
            return (
              <div key={option.id} className="banner-poll-option">
                <div className="banner-poll-option-row">
                  <input
                    type="text"
                    value={option.text}
                    placeholder={t('banner.optionPlaceholder', { n: index + 1 })}
                    aria-label={t('banner.optionPlaceholder', { n: index + 1 })}
                    onChange={(e) => setOptionText(index, e.target.value)}
                  />
                  <span
                    className="banner-poll-votes"
                    title={t('banner.votes')}
                  >
                    {option.votes}
                  </span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeOption(index)}
                    disabled={config.options.length <= 2}
                    aria-label={t('banner.removeOption')}
                  >
                    ×
                  </button>
                </div>
                {optionVoters.length > 0 && (
                  <div className="banner-poll-voters">
                    {optionVoters.map((voter) => (
                      <span
                        key={voter.userId}
                        className="banner-poll-voter"
                        title={voter.email || voter.phone || undefined}
                      >
                        {voter.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <p className="ae-hint">
          {t('banner.totalVotes', { n: totalVotes })}
          {totalVotes === 0 ? ` · ${t('banner.noVoters')}` : ''}
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={addOption}
          disabled={config.options.length >= 10}
        >
          + {t('banner.addOption')}
        </button>
      </div>
    </>
  )
}

function ContactsFields({
  config,
  onChange,
}: {
  config: BannerContactsConfig
  onChange: (c: BannerContactsConfig) => void
}) {
  const { t } = useI18n()

  const setContact = (index: number, patch: Partial<BannerContactItem>) => {
    const contacts = config.contacts.map((c, i) =>
      i === index ? { ...c, ...patch } : c
    )
    onChange({ ...config, contacts })
  }

  const removeContact = (index: number) => {
    if (config.contacts.length <= 1) return
    onChange({
      ...config,
      contacts: config.contacts.filter((_, i) => i !== index),
    })
  }

  const addContact = () => {
    if (config.contacts.length >= 6) return
    onChange({
      ...config,
      contacts: [
        ...config.contacts,
        { platform: 'whatsapp', value: '', label: 'WhatsApp' },
      ],
    })
  }

  return (
    <>
      <div className="ae-row">
        <div className="form-group">
          <span className="ae-duration-label">{t('banner.placement')}</span>
          <div className="tag-visibility-modes" role="radiogroup" aria-label={t('banner.placement')}>
            {(
              [
                ['top', t('banner.placementTop')],
                ['bottom', t('banner.placementBottom')],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`tag-mode ${config.placement === value ? 'is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="banner-contacts-placement"
                  checked={config.placement === value}
                  onChange={() => onChange({ ...config, placement: value })}
                />
                <span className="tag-mode-text">
                  <strong>{label}</strong>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="form-group">
          <span className="ae-duration-label">{t('banner.alignment')}</span>
          <div className="tag-visibility-modes" role="radiogroup" aria-label={t('banner.alignment')}>
            {ALIGNMENTS.map((alignment) => (
              <label
                key={alignment}
                className={`tag-mode ${config.alignment === alignment ? 'is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="banner-contacts-alignment"
                  checked={config.alignment === alignment}
                  onChange={() => onChange({ ...config, alignment })}
                />
                <span className="tag-mode-text">
                  <strong>
                    {t(`banner.align${alignment.charAt(0).toUpperCase()}${alignment.slice(1)}` as 'banner.alignLeft')}
                  </strong>
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="form-group">
        <span className="ae-duration-label">{t('banner.backgroundType')}</span>
        <div className="tag-visibility-modes" role="radiogroup" aria-label={t('banner.backgroundType')}>
          {(
            [
              ['color', t('banner.backgroundSolid')],
              ['gradient', t('banner.backgroundGradient')],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`tag-mode ${(config.backgroundType ?? 'color') === value ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="banner-contacts-background"
                checked={(config.backgroundType ?? 'color') === value}
                onChange={() => onChange({ ...config, backgroundType: value })}
              />
              <span className="tag-mode-text">
                <strong>{label}</strong>
              </span>
            </label>
          ))}
        </div>
      </div>

      {(config.backgroundType ?? 'color') === 'color' && (
        <div className="ae-row">
          <div className="form-group">
            <label htmlFor="banner-contacts-bg-color">{t('banner.backgroundColor')}</label>
            <input
              id="banner-contacts-bg-color"
              type="color"
              value={config.backgroundColor || '#3b82f6'}
              onChange={(e) => onChange({ ...config, backgroundColor: e.target.value })}
            />
          </div>
        </div>
      )}

      {(config.backgroundType ?? 'color') === 'gradient' && (
        <div className="ae-row">
          <div className="form-group">
            <label htmlFor="banner-contacts-gradient-from">{t('banner.gradientFrom')}</label>
            <input
              id="banner-contacts-gradient-from"
              type="color"
              value={config.gradientFrom || '#3b82f6'}
              onChange={(e) => onChange({ ...config, gradientFrom: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="banner-contacts-gradient-to">{t('banner.gradientTo')}</label>
            <input
              id="banner-contacts-gradient-to"
              type="color"
              value={config.gradientTo || '#8b5cf6'}
              onChange={(e) => onChange({ ...config, gradientTo: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="ae-row">
        <div className="form-group">
          <span className="ae-duration-label">{t('banner.buttonStyle')}</span>
          <div className="tag-visibility-modes" role="radiogroup" aria-label={t('banner.buttonStyle')}>
            {(
              [
                ['filled', t('banner.styleFilled')],
                ['outline', t('banner.styleOutline')],
              ] as const
            ).map(([value, label]) => (
              <label
                key={value}
                className={`tag-mode ${(config.buttonStyle ?? 'filled') === value ? 'is-active' : ''}`}
              >
                <input
                  type="radio"
                  name="banner-contacts-button-style"
                  checked={(config.buttonStyle ?? 'filled') === value}
                  onChange={() => onChange({ ...config, buttonStyle: value })}
                />
                <span className="tag-mode-text">
                  <strong>{label}</strong>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="banner-contacts-button-color">{t('banner.buttonColor')}</label>
          <input
            id="banner-contacts-button-color"
            type="color"
            value={config.buttonColor || '#ffffff'}
            onChange={(e) => onChange({ ...config, buttonColor: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label htmlFor="banner-contacts-button-font">{t('banner.buttonFontColor')}</label>
          <input
            id="banner-contacts-button-font"
            type="color"
            value={config.buttonFontColor || '#ffffff'}
            onChange={(e) => onChange({ ...config, buttonFontColor: e.target.value })}
          />
        </div>
      </div>

      <div className="form-group">
        <label>{t('banner.contacts')}</label>
        <div className="banner-contact-list">
          {config.contacts.map((contact, index) => (
            <div key={index} className="banner-contact-row">
              <select
                value={contact.platform}
                aria-label={t('banner.platform')}
                onChange={(e) =>
                  setContact(index, {
                    platform: e.target.value as BannerContactItem['platform'],
                  })
                }
              >
                <option value="whatsapp">WhatsApp</option>
                <option value="telegram">Telegram</option>
                <option value="phone">{t('banner.phone')}</option>
                <option value="email">{t('banner.email')}</option>
                <option value="link">{t('banner.link')}</option>
              </select>
              <input
                type="text"
                value={contact.value}
                placeholder={t('banner.valuePlaceholder')}
                aria-label={t('banner.value')}
                onChange={(e) => setContact(index, { value: e.target.value })}
              />
              <input
                type="text"
                value={contact.label}
                placeholder={t('banner.label')}
                aria-label={t('banner.label')}
                onChange={(e) => setContact(index, { label: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => removeContact(index)}
                disabled={config.contacts.length <= 1}
                aria-label={t('banner.removeContact')}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={addContact}
          disabled={config.contacts.length >= 6}
        >
          + {t('banner.addContact')}
        </button>
      </div>
    </>
  )
}

function AnnouncementFields({
  config,
  onChange,
  duration,
  onDuration,
}: {
  config: BannerAnnouncementConfig
  onChange: (c: BannerAnnouncementConfig) => void
  duration: number
  onDuration: (d: number) => void
}) {
  const { t } = useI18n()
  const textRef = useRef<HTMLTextAreaElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const emojiRef = useRef<HTMLDivElement>(null)

  // The emoji dropdown closes when the pointer leaves it.
  useEffect(() => {
    if (!emojiOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setEmojiOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [emojiOpen])

  /** Inserts text at the cursor, keeping the caret after it. */
  const insertAtCursor = (text: string) => {
    const current = config.text ?? ''
    const textarea = textRef.current
    if (!textarea) {
      onChange({ ...config, text: current + text })
      return
    }
    const start = textarea.selectionStart ?? current.length
    const end = textarea.selectionEnd ?? current.length
    onChange({
      ...config,
      text: current.slice(0, start) + text + current.slice(end),
    })
    requestAnimationFrame(() => {
      textarea.focus()
      const pos = start + text.length
      textarea.setSelectionRange(pos, pos)
    })
  }

  const insertQuote = () => {
    const current = config.text ?? ''
    const needsNewline = current.length > 0 && !current.endsWith('\n')
    insertAtCursor(`${needsNewline ? '\n' : ''}> `)
  }

  const insertTable = () => {
    const current = config.text ?? ''
    const needsNewline = current.length > 0 && !current.endsWith('\n')
    insertAtCursor(
      `${needsNewline ? '\n' : ''}| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |\n`
    )
  }

  const insertList = () => {
    const current = config.text ?? ''
    const needsNewline = current.length > 0 && !current.endsWith('\n')
    insertAtCursor(
      `${needsNewline ? '\n' : ''}1. First item\n2. Second item\n3. Third item\n`
    )
  }

  const insertEmoji = (emoji: string) => {
    insertAtCursor(emoji)
    setEmojiOpen(false)
  }

  return (
    <>
      <div className="form-group">
        <label htmlFor="banner-announcement-text">{t('banner.text')}</label>
        <div className="rte">
          <div className="rte-toolbar" role="toolbar" aria-label={t('banner.text')}>
            <div className="rte-group">
              <select
                className="rte-select"
                value={config.fontFamily ?? ''}
                title={t('banner.fontStyle')}
                aria-label={t('banner.fontStyle')}
                onChange={(e) => onChange({ ...config, fontFamily: e.target.value })}
              >
                {FONT_FAMILY_OPTIONS.map((font) => (
                  <option key={font.value || 'default'} value={font.value}>
                    {t(font.labelKey)}
                  </option>
                ))}
              </select>
              <select
                className="rte-select"
                value={config.fontSize ?? ''}
                title={t('banner.fontSize')}
                aria-label={t('banner.fontSize')}
                onChange={(e) => onChange({ ...config, fontSize: e.target.value })}
              >
                {FONT_SIZE_OPTIONS.map((size) => (
                  <option key={size.value || 'default'} value={size.value}>
                    {t(size.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            <div className="rte-group">
              {ALIGNMENTS.map((alignment) => (
                <button
                  key={alignment}
                  type="button"
                  className={`rte-btn ${(config.alignment ?? 'center') === alignment ? 'is-on' : ''}`}
                  title={t(`banner.align${alignment.charAt(0).toUpperCase()}${alignment.slice(1)}` as 'banner.alignLeft')}
                  aria-label={t(`banner.align${alignment.charAt(0).toUpperCase()}${alignment.slice(1)}` as 'banner.alignLeft')}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange({ ...config, alignment })}
                >
                  {{ left: '⇤', center: '⇔', right: '⇥' }[alignment]}
                </button>
              ))}
            </div>

            <div className="rte-group">
              <button
                type="button"
                className="rte-btn"
                onClick={insertQuote}
                onMouseDown={(e) => e.preventDefault()}
                title={t('banner.quoteHint')}
                aria-label={t('banner.insertQuote')}
              >
                ❝
              </button>
              <button
                type="button"
                className="rte-btn"
                onClick={insertTable}
                onMouseDown={(e) => e.preventDefault()}
                title={t('banner.tableHint')}
                aria-label={t('banner.insertTable')}
              >
                ▦
              </button>
              <button
                type="button"
                className="rte-btn"
                onClick={insertList}
                onMouseDown={(e) => e.preventDefault()}
                title={t('banner.listHint')}
                aria-label={t('banner.insertList')}
              >
                1≡
              </button>
            </div>

            <div className="rte-group rte-group--emoji" ref={emojiRef}>
              <button
                type="button"
                className={`rte-btn ${emojiOpen ? 'is-on' : ''}`}
                title={t('banner.emoji')}
                aria-label={t('banner.emoji')}
                aria-expanded={emojiOpen}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setEmojiOpen((o) => !o)}
              >
                🙂
              </button>
              {emojiOpen && (
                <div className="rte-emoji-menu" role="menu">
                  {EMOJI_GROUPS.map((group) => (
                    <div key={group.label} className="rte-emoji-group">
                      <p className="rte-emoji-group-label">{t(group.label)}</p>
                      <div className="rte-emoji-grid">
                        {group.items.map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            className="rte-emoji"
                            role="menuitem"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => insertEmoji(emoji)}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <textarea
            id="banner-announcement-text"
            ref={textRef}
            className="rte-surface"
            value={config.text}
            onChange={(e) => onChange({ ...config, text: e.target.value })}
            rows={4}
            maxLength={2000}
            required
          />
        </div>
        <p className="ae-hint">
          {t('banner.quoteHint')} · {t('banner.tableHint')} · {t('banner.listHint')}
        </p>
        <p className="ae-hint">{t('banner.announcementHint')}</p>
      </div>

      <div className="form-group">
        <span className="ae-duration-label">{t('banner.backgroundType')}</span>
        <div className="tag-visibility-modes" role="radiogroup" aria-label={t('banner.backgroundType')}>
          {(
            [
              ['color', t('banner.backgroundSolid')],
              ['gradient', t('banner.backgroundGradient')],
            ] as const
          ).map(([value, label]) => (
            <label
              key={value}
              className={`tag-mode ${(config.backgroundType ?? 'color') === value ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="banner-announcement-background"
                checked={(config.backgroundType ?? 'color') === value}
                onChange={() => onChange({ ...config, backgroundType: value })}
              />
              <span className="tag-mode-text">
                <strong>{label}</strong>
              </span>
            </label>
          ))}
        </div>
      </div>

      {(config.backgroundType ?? 'color') === 'color' && (
        <div className="ae-row">
          <div className="form-group">
            <label htmlFor="banner-announcement-bg">{t('banner.backgroundColor')}</label>
            <input
              id="banner-announcement-bg"
              type="color"
              value={config.backgroundColor || '#3b82f6'}
              onChange={(e) => onChange({ ...config, backgroundColor: e.target.value })}
            />
          </div>
        </div>
      )}

      {(config.backgroundType ?? 'color') === 'gradient' && (
        <div className="ae-row">
          <div className="form-group">
            <label htmlFor="banner-announcement-gradient-from">{t('banner.gradientFrom')}</label>
            <input
              id="banner-announcement-gradient-from"
              type="color"
              value={config.gradientFrom || '#3b82f6'}
              onChange={(e) => onChange({ ...config, gradientFrom: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label htmlFor="banner-announcement-gradient-to">{t('banner.gradientTo')}</label>
            <input
              id="banner-announcement-gradient-to"
              type="color"
              value={config.gradientTo || '#8b5cf6'}
              onChange={(e) => onChange({ ...config, gradientTo: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="ae-row">
        <div className="form-group">
          <label htmlFor="banner-announcement-font">{t('banner.fontColor')}</label>
          <input
            id="banner-announcement-font"
            type="color"
            value={config.fontColor || '#ffffff'}
            onChange={(e) => onChange({ ...config, fontColor: e.target.value })}
          />
        </div>
      </div>

      <div className="form-group">
        <label htmlFor="banner-duration">{t('banner.duration')}</label>
        <input
          id="banner-duration"
          type="number"
          min={1}
          max={60}
          value={duration}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onDuration(Math.min(60, Math.max(1, Math.round(n))))
          }}
        />
        <p className="ae-hint">{t('banner.durationHint')}</p>
      </div>
    </>
  )
}
