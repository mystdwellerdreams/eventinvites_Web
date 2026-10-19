import { useState, useEffect, useRef, useCallback } from 'react'
import './AvatarCropper.css'
import { useI18n } from '../i18n'
const OUTPUT_SIZE = 320

interface AvatarCropperProps {
  file: File
  onComplete: (croppedBlob: Blob) => void
  onCancel: () => void
}

interface Transform {
  scale: number
  rotation: number
  flipX: boolean
  flipY: boolean
  offsetX: number
  offsetY: number
}

const IDENTITY: Transform = { scale: 1, rotation: 0, flipX: false, flipY: false, offsetX: 0, offsetY: 0 }

export default function AvatarCropper({ file, onComplete, onCancel }: AvatarCropperProps) {
  const { t } = useI18n()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [transform, setTransform] = useState<Transform>(IDENTITY)
  const [imageSrc, setImageSrc] = useState('')
  const [imageReady, setImageReady] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragOrigin = useRef({ pointerX: 0, pointerY: 0, offsetX: 0, offsetY: 0 })

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImageSrc(url)
    // The new file has not loaded yet, so nothing may be drawn from the
    // previous one while its image is still in place.
    setImageReady(false)
    return () => URL.revokeObjectURL(url)
  }, [file])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [onCancel])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !imageReady || !img.naturalWidth) return

    canvas.width = OUTPUT_SIZE
    canvas.height = OUTPUT_SIZE

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 1. Isolate the circular frame.
    ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)
    ctx.save()
    ctx.beginPath()
    ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2)
    ctx.closePath()
    ctx.clip()

    // 2. Paint the frame so a transparent PNG still shows a background.
    ctx.fillStyle = '#e5e7eb'
    ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE)

    // 3. Draw the image cover-fit, then apply scale, rotation, flips and pan.
    const coverScale = Math.max(OUTPUT_SIZE / img.naturalWidth, OUTPUT_SIZE / img.naturalHeight)
    const finalScale = coverScale * transform.scale

    ctx.save()
    ctx.translate(OUTPUT_SIZE / 2 + transform.offsetX, OUTPUT_SIZE / 2 + transform.offsetY)
    ctx.rotate((transform.rotation * Math.PI) / 180)
    ctx.scale(
      (transform.flipX ? -1 : 1) * finalScale,
      (transform.flipY ? -1 : 1) * finalScale
    )
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(
      img,
      -img.naturalWidth / 2,
      -img.naturalHeight / 2,
      img.naturalWidth,
      img.naturalHeight
    )
    ctx.restore()
    ctx.restore()
  }, [imageReady, transform])

  useEffect(() => {
    draw()
  }, [draw])

  const clampScale = (value: number) => Math.min(4, Math.max(0.5, value))

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ;(e.target as HTMLCanvasElement).setPointerCapture?.(e.pointerId)
    dragOrigin.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      offsetX: transform.offsetX,
      offsetY: transform.offsetY,
    }
    setDragging(true)
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging) return
    setTransform((t) => ({
      ...t,
      offsetX: dragOrigin.current.offsetX + (e.clientX - dragOrigin.current.pointerX),
      offsetY: dragOrigin.current.offsetY + (e.clientY - dragOrigin.current.pointerY),
    }))
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ;(e.target as HTMLCanvasElement).releasePointerCapture?.(e.pointerId)
    setDragging(false)
  }

  const handleComplete = () => {
    canvasRef.current?.toBlob((blob) => {
      if (blob) onComplete(blob)
    }, 'image/png')
  }

  const update = (patch: Partial<Transform>) => setTransform((t) => ({ ...t, ...patch }))

  const rotateBy = (degrees: number) =>
    update({ rotation: (transform.rotation + degrees + 540) % 360 - 180 })

  const scaleLabel = `${Math.round(transform.scale * 100)}%`

  return (
    <div className="avatar-cropper-overlay">
      <div className="avatar-cropper" role="dialog" aria-modal="true" aria-label={t('crop.dialogLabel')}>
        <h3>{t('crop.title')}</h3>
        <p className="avatar-cropper-hint">
          Drag the image to reposition it, then zoom, rotate or flip it inside the circle.
        </p>

        <div className="avatar-cropper-stage">
          <canvas
            ref={canvasRef}
            className={`avatar-cropper-canvas${dragging ? ' is-dragging' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          />
          {/* The source only renders once the file's object URL exists:
              an empty string would be read as the page's own address. */}
          {imageSrc && (
            <img
              ref={imgRef}
              src={imageSrc}
              alt=""
              aria-hidden="true"
              onLoad={() => setImageReady(true)}
              className="avatar-cropper-source"
            />
          )}
        </div>

        <div className="avatar-cropper-controls">
          <div className="control-group">
            <label htmlFor="avatar-scale">Zoom: {scaleLabel}</label>
            <input
              id="avatar-scale"
              type="range"
              min="0.5"
              max="4"
              step="0.01"
              value={transform.scale}
              onChange={(e) => update({ scale: clampScale(parseFloat(e.target.value)) })}
            />
          </div>

          <div className="control-group">
            <label htmlFor="avatar-rotation">Rotation: {transform.rotation}°</label>
            <input
              id="avatar-rotation"
              type="range"
              min="-180"
              max="180"
              step="1"
              value={transform.rotation}
              onChange={(e) => update({ rotation: parseInt(e.target.value, 10) })}
            />
          </div>

          <div className="control-buttons">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => rotateBy(-90)}
              aria-label={t('crop.rotateLeft')}
            >
              ⟲ 90°
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => rotateBy(90)}
              aria-label={t('crop.rotateRight')}
            >
              ⟳ 90°
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => update({ flipX: !transform.flipX })}
              aria-pressed={transform.flipX}
            >
              Flip horizontal
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => update({ flipY: !transform.flipY })}
              aria-pressed={transform.flipY}
            >
              Flip vertical
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setTransform(IDENTITY)}
            >
              Reset
            </button>
          </div>
        </div>

        <div className="avatar-cropper-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={handleComplete}>
            Use this image
          </button>
        </div>
      </div>
    </div>
  )
}

