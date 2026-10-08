import {
  overlayThemeOptions,
  SpaceOverlayProvider,
  TwakeMuiThemeProvider,
  type SpaceOverlay
} from '@linagora/twake-mui'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useMemo, type ReactElement, type ReactNode } from 'react'

import { PickersProvider } from '@/ds/Pickers'
import { I18nProvider } from '@/ui/i18n/I18nProvider'
import type { SupportedLanguage } from '@/ui/i18n/languages'

export interface AppProvidersProps {
  lang: SupportedLanguage
  queryClient: QueryClient
  // The overlay of TwakeSpace when the app is framed there: dialogs and side
  // panels go onto its page
  overlay?: SpaceOverlay | null
  children: ReactNode
}

export function AppProviders({
  lang,
  queryClient,
  overlay = null,
  children
}: AppProvidersProps): ReactElement {
  const themeOptions = useMemo(
    () => (overlay === null ? {} : overlayThemeOptions(overlay)),
    [overlay]
  )
  return (
    <TwakeMuiThemeProvider themeOptions={themeOptions}>
      <SpaceOverlayProvider overlay={overlay}>
        <I18nProvider lang={lang}>
          <PickersProvider lang={lang}>
            <QueryClientProvider client={queryClient}>
              {children}
            </QueryClientProvider>
          </PickersProvider>
        </I18nProvider>
      </SpaceOverlayProvider>
    </TwakeMuiThemeProvider>
  )
}
