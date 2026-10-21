import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '../context/AuthContext'
import { useAuthModal } from '../context/AuthModalContext'
import { useI18n } from '../i18n'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useDropdownPosition } from '../hooks/useDropdownPosition'
import { adminAPI } from '../utils/api'
import { assetUrl } from '../utils/env'
import { hasRole, isGuest } from '../utils/roles'
import AuthModal from './AuthModal'
import FeedbackModal from './FeedbackModal'
import LanguagePicker from './LanguagePicker'
import NotificationBell from './NotificationBell'
import UserAvatar from './UserAvatar'
import ConnectivityIndicator from './ConnectivityIndicator'
import './Layout.css'

/** Storage key for the persisted theme choice. */
const THEME_KEY = 'event-invites:theme'

/**
 * Replaces the React Router layout: the App Router owns the page tree,
 * so this supplies the chrome and renders whatever route was matched.
 *
 * In landscape the header carries the logo and, on the right, a theme
 * toggle plus the signed-in user's name and avatar; clicking that
 * block opens a context menu with the profile, admin, logout and
 * language actions. In portrait — whenever the screen is taller than
 * it is wide — the logo text drops away, the logo icon centres
 * itself, and a single menu button opens the left panel. That panel
 * carries the profile, the logout and theme controls at the top and
 * the navigation below; the notifications bell takes the header's
 * right slot.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth()
  const { open } = useAuthModal()
  const { t } = useI18n()
  const pathname = usePathname() ?? '/'
  const router = useRouter()

  // Portrait is what turns the header into the compact layout.
  const isPortrait = useMediaQuery('(orientation: portrait)')
  const [navOpen, setNavOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  // The feedback form, opened from the header menu or the mobile drawer.
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  // Theme toggle: light is the default; the choice is
  // stored so it survives a reload. The state starts
  // false to keep the first client render identical to
  // the server's HTML; the stored preference is adopted
  // in an effect straight afterwards.
  const [dark, setDark] = useState(false)
  const [themeLoaded, setThemeLoaded] = useState(false)
  // Pending guest requests, counted on the left panel's Users item.
  const [pendingGuests, setPendingGuests] = useState(0)

  const menuRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const isAdmin = hasRole(user, 'ADMIN')

  const isActive = (path: string) =>
    path === '/' ? pathname === '/' : pathname.startsWith(path)

  // Event pages manage their own full-bleed width.
  const isEventPage = pathname.startsWith('/events/')

  const closePanels = () => {
    setNavOpen(false)
  }

  const openNavPanel = () => {
    setMenuOpen(false)
    setNavOpen(true)
  }

  // Keeps the user menu inside the screen, flipping it
  // above the avatar when there is no room below.
  const contextMenuStyle = useDropdownPosition(
    menuOpen,
    menuRef,
    contextMenuRef
  )

  // Portrait is what makes the panels visible; drop their state with it.
  useEffect(() => {
    if (!isPortrait) closePanels()
  }, [isPortrait])

  // Escape closes whichever panel or menu is open.
  useEffect(() => {
    if (!navOpen && !menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closePanels()
        setMenuOpen(false)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [navOpen, menuOpen])

  // An open panel covers the page, so the content behind it stops scrolling.
  useEffect(() => {
    const locked = navOpen
    document.body.style.overflow = locked ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [navOpen])

  // The context menu closes on an outside click.
  useEffect(() => {
    if (!menuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  // The left panel's Users item counts guest requests awaiting approval.
  useEffect(() => {
    if (!navOpen || !isAdmin) return
    let active = true
    adminAPI
      .guests()
      .then((r) => {
        if (active) {
          const guests = r.data?.guests
          setPendingGuests(Array.isArray(guests) ? guests.length : 0)
        }
      })
      .catch(() => {
        // The count simply stays hidden.
      })
    return () => {
      active = false
    }
  }, [navOpen, isAdmin])

  // Adopt the stored theme once on mount, then keep
  // the document's theme attribute and storage in sync.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY)
      if (stored === 'dark' || stored === 'light') {
        setDark(stored === 'dark')
      }
    } catch {
      // A blocked storage API just means the default lasts.
    }
    setThemeLoaded(true)
  }, [])

  useEffect(() => {
    if (!themeLoaded) return
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    try {
      window.localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
    } catch {
      // A blocked storage API just means the choice lasts this session.
    }
  }, [dark, themeLoaded])

  const handleLogout = async () => {
    setMenuOpen(false)
    closePanels()
    await logout()
    router.push('/')
  }

  const themeToggle = (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setDark((d) => !d)}
      aria-label={t('nav.theme')}
      title={t('nav.theme')}
      aria-pressed={dark}
    >
      <span aria-hidden="true">{dark ? '☀️' : '🌙'}</span>
    </button>
  )

  return (
    <div className="layout">
      <header className="header">
        <div className="container header-inner">
          <Link href="/" className="logo logo-desktop">
            <img src={assetUrl('logo.png')} alt="" className="logo-icon" />
            <span className="logo-text">{t('app.name')}</span>
          </Link>

          <div className="header-actions header-actions-desktop">
            {user && <NotificationBell />}
            {themeToggle}

            {user ? (
              <div className="user-menu" ref={menuRef}>
                <button
                  type="button"
                  className="user-menu-button"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-expanded={menuOpen}
                  aria-haspopup="menu"
                >
                  <UserAvatar name={user.name} avatar={user.avatar} size={36} />
                  <span className="user-name">{user.name}</span>
                  <span className="caret" aria-hidden="true">
                    ▾
                  </span>
                </button>

                {menuOpen && (
                  <div
                    className="user-context-menu"
                    role="menu"
                    ref={contextMenuRef}
                    style={contextMenuStyle}
                  >
                    <Link
                      href="/profile"
                      role="menuitem"
                      className="user-context-item"
                      onClick={() => setMenuOpen(false)}
                    >
                      {t('nav.profile')}
                    </Link>
                    {!isGuest(user) && (
                      <Link
                        href="/messages"
                        role="menuitem"
                        className="user-context-item"
                        onClick={() => setMenuOpen(false)}
                      >
                        {t('nav.messages')}
                      </Link>
                    )}
                    {isAdmin && (
                      <Link
                        href="/admin"
                        role="menuitem"
                        className="user-context-item"
                        onClick={() => setMenuOpen(false)}
                      >
                        {t('nav.admin')}
                      </Link>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className="user-context-item"
                      onClick={() => {
                        setMenuOpen(false)
                        setFeedbackOpen(true)
                      }}
                    >
                      {t('nav.feedback')}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="user-context-item"
                      onClick={handleLogout}
                    >
                      {t('nav.logout')}
                    </button>
                    <div className="user-context-language">
                      <LanguagePicker />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button onClick={() => open('login')} className="btn btn-primary btn-sm">
                {t('nav.login')}
              </button>
            )}
          </div>

          <button
            type="button"
            className="mobile-menu-button"
            onClick={openNavPanel}
            aria-label={t('nav.menu')}
            aria-expanded={navOpen}
            aria-controls="mobile-nav-panel"
          >
            <span aria-hidden="true">☰</span>
          </button>

          <Link href="/" className="logo logo-mobile" aria-label={t('app.name')}>
            <img src={assetUrl('logo.png')} alt="" className="logo-icon" />
          </Link>

          <div className="mobile-user-slot">
            {user ? (
              <NotificationBell />
            ) : (
              <button
                type="button"
                onClick={() => open('login')}
                className="mobile-login-button btn btn-primary btn-sm"
              >
                {t('nav.login')}
              </button>
            )}
          </div>
        </div>
      </header>

      <div
        className={`drawer-overlay ${navOpen ? 'visible' : ''}`}
        onClick={closePanels}
        aria-hidden="true"
      />
      <aside
        id="mobile-nav-panel"
        className={`drawer drawer-left ${navOpen ? 'open' : ''}`}
        aria-hidden={!navOpen}
      >
        <div className="drawer-header">
          {user ? (
            <Link
              href="/profile"
              className="drawer-user"
              onClick={closePanels}
            >
              <UserAvatar name={user.name} avatar={user.avatar} size={36} />
              <span className="drawer-user-name">{user.name}</span>
            </Link>
          ) : (
            <span className="drawer-title">{t('app.name')}</span>
          )}
          <div className="drawer-header-actions">
            {user && (
              <button
                type="button"
                className="drawer-icon-button"
                onClick={handleLogout}
                aria-label={t('nav.logout')}
                title={t('nav.logout')}
              >
                <span aria-hidden="true">🚪</span>
              </button>
            )}
            <button
              type="button"
              className="drawer-close"
              onClick={closePanels}
              aria-label={t('nav.close')}
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>

        <div className="drawer-theme">{themeToggle}</div>
        <nav className="drawer-nav" aria-label={t('nav.menu')}>
          <div className="drawer-group">
            <Link
              href="/"
              className="drawer-group-title"
              onClick={closePanels}
            >
              <span className="drawer-icon" aria-hidden="true">
                🏠
              </span>
              {t('nav.home')}
            </Link>
            <div className="drawer-subitems">
              <Link
                href="/#announcements"
                className="drawer-subitem"
                onClick={closePanels}
              >
                {t('nav.announcements')}
              </Link>
              <Link
                href="/#events"
                className="drawer-subitem"
                onClick={closePanels}
              >
                {t('nav.events')}
              </Link>
            </div>
          </div>

          {user && !isAdmin && (
            <Link
              href="/users"
              className="drawer-item"
              onClick={closePanels}
            >
              <span className="drawer-icon" aria-hidden="true">
                👥
              </span>
              {t('nav.users')}
            </Link>
          )}

          {user && !isGuest(user) && (
            <Link
              href="/messages"
              className="drawer-item"
              onClick={closePanels}
            >
              <span className="drawer-icon" aria-hidden="true">
                💬
              </span>
              {t('nav.messages')}
            </Link>
          )}

          {isAdmin && (
            <div className="drawer-group">
              <Link
                href="/admin"
                className="drawer-group-title"
                onClick={closePanels}
              >
                <span className="drawer-icon" aria-hidden="true">
                  ⚙️
                </span>
                {t('nav.admin')}
              </Link>
              <div className="drawer-subitems">
                <Link
                  href="/admin?tab=events"
                  className="drawer-subitem"
                  onClick={closePanels}
                >
                  {t('admin.tabEvents')}
                </Link>
                <Link
                  href="/admin?tab=users"
                  className="drawer-subitem"
                  onClick={closePanels}
                >
                  {t('nav.users')}
                  {pendingGuests > 0 && (
                    <span className="drawer-badge">({pendingGuests})</span>
                  )}
                </Link>
                <Link
                  href="/admin?tab=tags"
                  className="drawer-subitem"
                  onClick={closePanels}
                >
                  {t('admin.tabTags')}
                </Link>
                <Link
                  href="/admin?tab=banners"
                  className="drawer-subitem"
                  onClick={closePanels}
                >
                  {t('admin.tabBanners')}
                </Link>
              </div>
            </div>
          )}

          {user && (
            <div className="drawer-group">
              <button
                type="button"
                className="drawer-group-title"
                onClick={() => {
                  closePanels()
                  setFeedbackOpen(true)
                }}
              >
                <span className="drawer-icon" aria-hidden="true">
                  ✉️
                </span>
                {t('nav.feedback')}
              </button>
            </div>
          )}

          {user && (
            <div className="drawer-language">
              <LanguagePicker />
            </div>
          )}
        </nav>
      </aside>

      <main className="main">{isEventPage ? children : <div className="container">{children}</div>}</main>

      <footer className="footer">
        <div className="container">
          <p>
            © {new Date().getFullYear()} {t('app.name')}. {t('footer.rights')}
          </p>
        </div>
      </footer>

      <AuthModal />
      {feedbackOpen && user && (
        <FeedbackModal onClose={() => setFeedbackOpen(false)} />
      )}

      {/* The connection controller: only shows while the internet, the
          database or the upload store is unavailable. */}
      <ConnectivityIndicator />
    </div>
  )
}
