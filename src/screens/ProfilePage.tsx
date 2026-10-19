import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'
import { useAuthModal } from '../context/AuthModalContext'
import { authAPI, uploadAPI, apiErrorMessage, resolveAssetUrl } from '../utils/api'
import type { SocialLink } from '../types'
import AvatarCropper from '../components/AvatarCropper'
import SocialLinksEditor from '../components/SocialLinksEditor'
import './ProfilePage.css'
import { useI18n } from '../i18n'

type Status = { kind: 'success' | 'error'; text: string } | null

export default function ProfilePage() {
  const { t } = useI18n()
  const { user, refreshUser, logout } = useAuth()
  const { open } = useAuthModal()
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    links: [] as SocialLink[],
  })
  const [passwordData, setPasswordData] = useState({ current: '', next: '' })
  const [saving, setSaving] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const [passwordStatus, setPasswordStatus] = useState<Status>(null)
  const [showAvatarCropper, setShowAvatarCropper] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  useEffect(() => {
    if (user) {
      setFormData({
        name: user.name,
        phone: user.phone || '',
        links: user.socialLinks ?? [],
      })
    }
  }, [user])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData((f) => ({ ...f, [name]: value }))
  }

  const handleLinksChange = (links: SocialLink[]) => {
    setFormData((f) => ({ ...f, links }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      // The server rebuilds each handle into the network's own URL format.
      await authAPI.updateProfile({
        name: formData.name,
        phone: formData.phone,
        socialLinks: formData.links.map((link) => ({
          platform: link.platform,
          value: link.url,
          label: link.label,
        })),
      })
      await refreshUser()
      setStatus({ kind: 'success', text: t('profile.updated') })
    } catch (err) {
      setStatus({ kind: 'error', text: apiErrorMessage(err, t('profile.updateFailed')) })
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingPassword(true)
    setPasswordStatus(null)
    try {
      await authAPI.changePassword(passwordData.current, passwordData.next)
      setPasswordData({ current: '', next: '' })
      setPasswordStatus({ kind: 'success', text: 'Password changed. Please sign in again.' })
      await logout()
      open('login')
    } catch (err) {
      setPasswordStatus({ kind: 'error', text: apiErrorMessage(err, t('profile.passwordFailed')) })
    } finally {
      setSavingPassword(false)
    }
  }

  const handleRemoveAvatar = useCallback(async () => {
    try {
      await authAPI.updateAvatar('')
      await refreshUser()
      setStatus({ kind: 'success', text: t('profile.avatarRemoved') })
    } catch (err) {
      setStatus({ kind: 'error', text: apiErrorMessage(err, t('profile.avatarRemoveFailed')) })
    }
  }, [refreshUser])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      setShowAvatarCropper(true)
    }
    e.target.value = ''
  }

  const handleAvatarCrop = async (croppedBlob: Blob) => {
    const uploadData = new FormData()
    uploadData.append('avatar', croppedBlob, 'avatar.png')
    try {
      const uploadResponse = await uploadAPI.uploadAvatar(uploadData)
      await authAPI.updateAvatar(uploadResponse.data.url)
      await refreshUser()
      setStatus({ kind: 'success', text: t('profile.avatarUpdated') })
    } catch (err) {
      setStatus({ kind: 'error', text: apiErrorMessage(err, t('profile.avatarFailed')) })
    }
    setShowAvatarCropper(false)
  }

  if (!user) {
    return <div className="profile-loading">{t('profile.loading')}</div>
  }

  return (
    <div className="profile-page">
      <h1>{t('profile.title')}</h1>
      <div className="profile-card">
        <div className="profile-avatar-section">
          <div className="profile-avatar">
            {user.avatar ? (
            <img src={resolveAssetUrl(user.avatar)} alt={user.name} />
          ) : (
            user.name.charAt(0).toUpperCase()
          )}
          </div>
          <div className="profile-avatar-buttons">
            <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
              {t('profile.changeAvatar')}
              <input type="file" accept="image/*" onChange={handleFileSelect} style={{ display: 'none' }} />
            </label>
            {user.avatar && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleRemoveAvatar}>
                {t('profile.removeAvatar')}
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="profile-form">
          <div className="form-group">
            <label htmlFor="name">{t('profile.name')}</label>
            <input
              type="text"
              id="name"
              name="name"
              value={formData.name}
              onChange={handleChange}
              required
              minLength={2}
            />
          </div>

          <div className="form-group">
            <label htmlFor="phone">{t('profile.phone')}</label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              placeholder={t('auth.phonePlaceholder')}
            />
            <small className="profile-hint">{t('profile.phoneHint')}</small>
          </div>

          <div className="form-group">
            <label htmlFor="email">{t('profile.email')}</label>
            <input type="email" id="email" value={user.email || ''} disabled placeholder={t('profile.notSet')} />
          </div>

          <div className="form-group">
            <label>{t('profile.role')}</label>
            <input type="text" value={user.role} disabled />
          </div>

          <div className="social-links">
            <h4>{t('profile.socialLinks')}</h4>
            <p className="profile-hint">{t('profile.socialLinksHint')}</p>
            <SocialLinksEditor links={formData.links} onChange={handleLinksChange} />
          </div>

          {status && <div className={`form-message ${status.kind}`}>{status.text}</div>}

          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? t('profile.saving') : t('profile.save')}
          </button>
        </form>
      </div>

      <div className="profile-card">
        <form onSubmit={handlePasswordSubmit} className="profile-form">
          <h4>{t('profile.changePassword')}</h4>
          <p className="profile-hint">
            {t('profile.passwordPhoneHint')}
          </p>
          <div className="form-group">
            <label htmlFor="current-password">{t('profile.currentPassword')}</label>
            <input
              type="password"
              id="current-password"
              autoComplete="current-password"
              value={passwordData.current}
              onChange={(e) => setPasswordData((p) => ({ ...p, current: e.target.value }))}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="new-password">{t('profile.newPassword')}</label>
            <input
              type="password"
              id="new-password"
              autoComplete="new-password"
              value={passwordData.next}
              onChange={(e) => setPasswordData((p) => ({ ...p, next: e.target.value }))}
              required
              minLength={6}
            />
          </div>
          {passwordStatus && (
            <div className={`form-message ${passwordStatus.kind}`}>{passwordStatus.text}</div>
          )}
          <button type="submit" className="btn btn-secondary" disabled={savingPassword}>
            {savingPassword ? t('profile.saving') : t('profile.updatePassword')}
          </button>
        </form>
      </div>

      {showAvatarCropper && selectedFile && (
        <AvatarCropper
          file={selectedFile}
          onComplete={handleAvatarCrop}
          onCancel={() => setShowAvatarCropper(false)}
        />
      )}
    </div>
  )
}

