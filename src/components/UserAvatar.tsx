import { resolveAssetUrl } from '../utils/api'
import './UserAvatar.css'

interface UserAvatarProps {
  name: string
  avatar?: string | null
  /** Rendered size in pixels; the circle is always this wide and tall. */
  size?: number
  className?: string
}

/**
 * A user's avatar rendered in a fixed circular box.
 *
 * Both the uploaded image and the initial placeholder occupy exactly the same
 * box, so a user with a photo can never render larger than one without.
 */
export default function UserAvatar({
  name,
  avatar,
  size = 32,
  className = '',
}: UserAvatarProps) {
  const initial = name?.trim()?.charAt(0).toUpperCase() || '?'
  const src = resolveAssetUrl(avatar)

  return (
    <span
      className={`user-avatar-box ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.4)) }}
      title={name}
    >
      {src ? (
        <img src={src} alt={name} loading="lazy" />
      ) : (
        <span className="user-avatar-initial" aria-hidden="true">
          {initial}
        </span>
      )}
    </span>
  )
}
