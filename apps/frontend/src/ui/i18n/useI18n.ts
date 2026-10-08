import { useI18n as useTwakeI18n } from 'twake-i18n'

import type en from '@/locales/en.json'

type LeafPaths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${Prefix}${K}`
    : LeafPaths<T[K], `${Prefix}${K}.`>
}[keyof T & string]

export type TranslationKey = LeafPaths<typeof en>

export interface I18nApi {
  t: (key: TranslationKey, options?: Record<string, string | number>) => string
  lang: string
}

export function useI18n(): I18nApi {
  const { t, lang } = useTwakeI18n()
  return { t, lang }
}
