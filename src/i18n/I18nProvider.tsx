import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

export const LOCALES = ['en', 'ru'] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  ru: 'Русский',
}

const STORAGE_KEY = 'event-invites:locale'

/** Picks a sensible starting language from the browser. */
function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return 'ru'
  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
  for (const tag of candidates) {
    const base = tag?.toLowerCase().split('-')[0]
    if (base && (LOCALES as readonly string[]).includes(base)) return base as Locale
  }
  return 'ru'
}

function readStored(): Locale | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value && (LOCALES as readonly string[]).includes(value) ? (value as Locale) : null
  } catch {
    return null
  }
}

type Replacements = Record<string, string | number>

interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: string, vars?: Replacements) => string
  /**
   * Picks the right Russian form for a count: one / few / many.
   * Ignores the count elsewhere, so English stays "1 item".
   */
  plural: (count: number, one: string, few: string, many: string) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }
  return context
}

export function I18nProvider({
  children,
  catalogues,
}: {
  children: ReactNode
  catalogues: Record<string, Record<string, string>>
}) {
  // The server has no localStorage and no navigator, so it can only render the
  // default language. Seeding the state with it keeps the first client render
  // byte-identical to the server's HTML; the stored preference is adopted in an
  // effect straight afterwards. Reading storage during initialisation instead
  // would make the client render a different language from the server and
  // trip a hydration mismatch.
  const [locale, setLocaleState] = useState<Locale>('ru')
  const [preferenceLoaded, setPreferenceLoaded] = useState(false)

  useEffect(() => {
    setLocaleState(readStored() ?? detectLocale())
    setPreferenceLoaded(true)
  }, [])

  useEffect(() => {
    // Only trust the server's own attribute once the preference has loaded.
    if (preferenceLoaded) {
      document.documentElement.lang = locale
    }
  }, [locale, preferenceLoaded])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // A blocked storage API just means the choice lasts this session.
    }
  }, [])

  const t = useCallback(
    (key: string, vars?: Replacements) => {
      const table = catalogues[locale] ?? catalogues.en
      // English is the fallback so a missing key is visible in development
      // rather than rendering blank.
      const template = table?.[key] ?? catalogues.en?.[key] ?? key
      if (!vars) return template
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match
      )
    },
    [catalogues, locale]
  )

  const plural = useCallback(
    (count: number, one: string, few: string, many: string) => {
      if (locale !== 'ru') return `${count} ${one}`
      const n = Math.abs(count)
      const mod10 = n % 10
      const mod100 = n % 100
      // 1, 21, 31 -> one; 2-4, 22-24 -> few; everything else -> many.
      if (mod10 === 1 && mod100 !== 11) return one
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
      return many
    },
    [locale]
  )

  const value = useMemo(
    () => ({ locale, setLocale, t, plural }),
    [locale, setLocale, t, plural]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}