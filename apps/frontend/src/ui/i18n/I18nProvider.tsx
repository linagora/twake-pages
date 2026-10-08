import { useEffect, type ReactElement, type ReactNode } from 'react'
import { I18n } from 'twake-i18n'

import en from '@/locales/en.json'
import fr from '@/locales/fr.json'
import { DEFAULT_LANGUAGE, type SupportedLanguage } from '@/ui/i18n/languages'

const DICTIONARIES: Record<SupportedLanguage, typeof en> = { en, fr }

function dictionary(lang: SupportedLanguage): typeof en {
  return DICTIONARIES[lang]
}

export interface I18nProviderProps {
  lang: SupportedLanguage
  children: ReactNode
}

export function I18nProvider({
  lang,
  children
}: I18nProviderProps): ReactElement {
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return (
    <I18n
      lang={lang}
      defaultLang={DEFAULT_LANGUAGE}
      dictRequire={dictionary}
      polyglot={null}
      context={null}
    >
      {children}
    </I18n>
  )
}
