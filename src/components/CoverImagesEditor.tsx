import { useState } from 'react'
import { uploadAPI, resolveAssetUrl } from '../utils/api'
import './CoverImagesEditor.css'
import { useI18n } from '../i18n'

export interface CoverImageRow {
  /** Empty while the administrator is still typing or picking a file. */
  url: string
}

interface CoverImagesEditorProps {
  images: CoverImageRow[]
  onChange: (rows: CoverImageRow[]) => void
  max?: number
}

/**
 * Manages the event's image gallery.
 *
 * The first row is the cover: it keeps its own field and upload button, with a
 * thumbnail beside it. "Add image" appends further rows that can be reordered,
 * which the event page then presents as a carousel.
 */
export default function CoverImagesEditor({
  images,
  onChange,
  max = 12,
}: CoverImagesEditorProps) {
  const { t } = useI18n()
  const [busyIndex, setBusyIndex] = useState<number | null>(null)
  const [error, setError] = useState('')

  const setUrl = (index: number, url: string) => {
    const next = [...images]
    next[index] = { url }
    onChange(next)
  }

  const removeAt = (index: number) => {
    onChange(images.filter((_, i) => i !== index))
  }

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= images.length) return
    const next = [...images]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const makePrimary = (index: number) => {
    if (index === 0) return
    const next = [...images]
    const [picked] = next.splice(index, 1)
    onChange([picked, ...next])
  }

  const upload = async (index: number, file: File) => {
    setBusyIndex(index)
    setError('')
    try {
      const fd = new FormData()
      fd.append('cover', file)
      const r = await uploadAPI.uploadCover(fd)
      setUrl(index, r.data.url)
    } catch (err) {
      setError(t('editor.uploadFailed'))
    } finally {
      setBusyIndex(null)
    }
  }

  return (
    <div className="cover-images">
      <ul className="cover-images-list">
        {images.map((row, index) => {
          const isPrimary = index === 0
          return (
            <li
              key={index}
              className={`cover-images-row ${isPrimary ? 'is-primary' : ''}`}
            >
              {isPrimary && <span className="cover-images-badge">{t('editor.coverBadge')}</span>}

              <div className="cover-images-fields">
                <input
                  type="text"
                  value={row.url}
                  placeholder={t('editor.imageUrlPlaceholder')}
                  aria-label={isPrimary ? t('editor.coverUrl') : t('editor.imageUrl', { n: index + 1 })}
                  onChange={(e) => setUrl(index, e.target.value)}
                />
                <label className="btn btn-secondary btn-sm cover-images-upload">
                  {busyIndex === index ? t('editor.uploading') : t('editor.upload')}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) upload(index, file)
                      e.target.value = ''
                    }}
                  />
                </label>
                {row.url && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => removeAt(index)}
                  >
                    {t('editor.remove')}
                  </button>
                )}
              </div>

              <div className="cover-images-controls">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={t('editor.moveEarlier')}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => move(index, 1)}
                  disabled={index === images.length - 1}
                  aria-label={t('editor.moveLater')}
                >
                  ↓
                </button>
                {!isPrimary && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => makePrimary(index)}
                  >
                    {t('editor.makeCover')}
                  </button>
                )}
              </div>

              <div className="cover-images-thumb">
                {row.url ? (
                  <img
                    src={resolveAssetUrl(row.url)}
                    alt={`Preview ${index + 1}`}
                    loading="lazy"
                  />
                ) : (
                  <span className="cover-images-thumb-empty">{t('editor.imageNoImage')}</span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {error && <p className="cover-images-error">{error}</p>}

      <div className="cover-images-footer">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={images.length >= max}
          onClick={() => onChange([...images, { url: '' }])}
        >
          {t('editor.addImage')}
        </button>
        <span className="cover-images-count">
          {t('editor.imageCount', { count: images.length, max })}
        </span>
      </div>
    </div>
  )
}
