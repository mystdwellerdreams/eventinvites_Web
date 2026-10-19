import { useI18n } from '../i18n'
import type { BannerAlignment, BannerVerticalAlignment } from '../types'

/**
 * Text styling controls shared by every editor that styles a block of
 * text: the banner cover, the announcement, and the event page's cover
 * text. Keeping one implementation means the look of a control and the
 * keys behind its labels cannot drift between screens.
 */

export const ALIGNMENTS: BannerAlignment[] = ['left', 'center', 'right']

export const VERTICAL_ALIGNMENTS: BannerVerticalAlignment[] = ['top', 'center', 'bottom']

/** Font families offered by the style control. */
export const FONT_FAMILY_OPTIONS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'banner.fontDefault' },
  { value: 'Georgia, "Times New Roman", serif', labelKey: 'banner.fontSerif' },
  { value: '"Fira Code", "Courier New", monospace', labelKey: 'banner.fontMono' },
]

/** Font sizes for a headline. The first entry leaves the size to CSS. */
export const FONT_SIZE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'banner.fontSizeDefault' },
  { value: '1.1rem', labelKey: 'banner.fontSizeSmall' },
  { value: '1.35rem', labelKey: 'banner.fontSizeMedium' },
  { value: '1.6rem', labelKey: 'banner.fontSizeLarge' },
  { value: '1.9rem', labelKey: 'banner.fontSizeXl' },
]

/** The same steps, sized for body text. */
export const DESCRIPTION_FONT_SIZE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: '', labelKey: 'banner.fontSizeDefault' },
  { value: '0.9rem', labelKey: 'banner.fontSizeSmall' },
  { value: '1rem', labelKey: 'banner.fontSizeMedium' },
  { value: '1.2rem', labelKey: 'banner.fontSizeLarge' },
  { value: '1.4rem', labelKey: 'banner.fontSizeXl' },
]

/** Left / center / right radio row. */
export function AlignmentPicker({
  name,
  value,
  label,
  onChange,
}: {
  name: string
  value: BannerAlignment
  label: string
  onChange: (alignment: BannerAlignment) => void
}) {
  const { t } = useI18n()
  return (
    <div className="tag-visibility-modes" role="radiogroup" aria-label={label}>
      {ALIGNMENTS.map((alignment) => (
        <label
          key={alignment}
          className={`tag-mode ${value === alignment ? 'is-active' : ''}`}
        >
          <input
            type="radio"
            name={name}
            checked={value === alignment}
            onChange={() => onChange(alignment)}
          />
          <span className="tag-mode-text">
            <strong>{t(`banner.align${alignment.charAt(0).toUpperCase()}${alignment.slice(1)}` as 'banner.alignLeft')}</strong>
          </span>
        </label>
      ))}
    </div>
  )
}

/** Font family select. */
export function FontStyleSelect({
  id,
  value,
  onChange,
}: {
  id: string
  value: string
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {FONT_FAMILY_OPTIONS.map((font) => (
        <option key={font.value || 'default'} value={font.value}>
          {t(font.labelKey)}
        </option>
      ))}
    </select>
  )
}

/** Font size select; the steps differ between a headline and body text. */
export function FontSizeSelect({
  id,
  value,
  sizes,
  onChange,
}: {
  id: string
  value: string
  sizes: { value: string; labelKey: string }[]
  onChange: (value: string) => void
}) {
  const { t } = useI18n()
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      {sizes.map((size) => (
        <option key={size.value || 'default'} value={size.value}>
          {t(size.labelKey)}
        </option>
      ))}
    </select>
  )
}

/** Top / center / bottom radio row, deciding where a text block sits. */
export function VerticalAlignmentPicker({
  name,
  value,
  label,
  onChange,
}: {
  name: string
  value: BannerVerticalAlignment
  label: string
  onChange: (alignment: BannerVerticalAlignment) => void
}) {
  const { t } = useI18n()
  return (
    <div className="tag-visibility-modes" role="radiogroup" aria-label={label}>
      {VERTICAL_ALIGNMENTS.map((alignment) => (
        <label
          key={alignment}
          className={`tag-mode ${value === alignment ? 'is-active' : ''}`}
        >
          <input
            type="radio"
            name={name}
            checked={value === alignment}
            onChange={() => onChange(alignment)}
          />
          <span className="tag-mode-text">
            <strong>
              {t(`banner.vertical${alignment.charAt(0).toUpperCase()}${alignment.slice(1)}` as 'banner.verticalTop')}
            </strong>
          </span>
        </label>
      ))}
    </div>
  )
}
