import { en } from './en'
import { ru } from './ru'

export const catalogues: Record<string, Record<string, string>> = { en, ru }

export * from './I18nProvider'
export type { TranslationKey, Catalogue } from './en'