import { useState } from 'react'
import type { SocialPlatform } from '../types'
import { SOCIAL_PLATFORM_SPECS, SOCIAL_PLATFORM_ORDER } from '../utils/socialPlatforms'
import './InviteShare.css'
import { useI18n } from '../i18n'

interface InviteShareProps {
  /** The full registration URL to share. */
  url: string
}

const SHARE_TEXT = 'Join our events — register here:'

/** Builds the prefilled share URL for each network. */
function shareUrl(platform: SocialPlatform, url: string): string {
  const text = encodeURIComponent(`${SHARE_TEXT} ${url}`)
  const u = encodeURIComponent(url)
  switch (platform) {
    case 'whatsapp':
      return `https://wa.me/?text=${text}`
    case 'telegram':
      return `https://t.me/share/url?url=${u}&text=${encodeURIComponent(SHARE_TEXT)}`
    case 'x':
      return `https://x.com/intent/post?text=${text}`
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`
    case 'instagram':
    case 'custom':
    default:
      return url
  }
}

export default function InviteShare({ url }: InviteShareProps) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  const copy = async () => {
    setCopied(false)
    setFailed(false)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        throw new Error(t('share.unavailable'))
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard needs a secure context; show the link so it can be copied by hand.
      setFailed(true)
    }
  }

  return (
    <div className="invite-share">
      <div className="invite-share-row">
        <input readOnly value={url} className="invite-share-url" aria-label={t('share.urlLabel')} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
          {copied ? t('share.copied') : t('share.copy')}
        </button>
      </div>
      {failed && (
        <p className="invite-share-note">
          Copying was blocked by the browser. Select the link above and copy it manually.
        </p>
      )}

      <div className="invite-share-targets">
        <span className="invite-share-label">{t('share.shareOn')}</span>
        {SOCIAL_PLATFORM_ORDER.filter((p) => p !== 'custom').map((platform) => {
          const spec = SOCIAL_PLATFORM_SPECS[platform]
          return (
            <a
              key={platform}
              className="invite-share-btn"
              href={shareUrl(platform, url)}
              target="_blank"
              rel="noopener noreferrer"
              title={t('share.shareOnPlatform', { platform: spec.label })}
            >
              <span aria-hidden="true">{spec.icon}</span>
              <span>{spec.label}</span>
            </a>
          )
        })}
      </div>
    </div>
  )
}
