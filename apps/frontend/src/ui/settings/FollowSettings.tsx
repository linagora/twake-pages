import { useColorScheme } from '@linagora/twake-mui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, type ReactElement, type ReactNode } from 'react'

import type { UserSettings } from '@/application/pages'
import { PickersProvider } from '@/ds/Pickers'
import { I18nProvider } from '@/ui/i18n/I18nProvider'
import { resolveLanguage } from '@/ui/i18n/languages'
import { useI18n } from '@/ui/i18n/useI18n'
import { usePagesApi } from '@/ui/PagesApiProvider'
import { settingsKey, useSettings } from '@/ui/settings/useSettings'
import { followZone } from '@/ui/settings/zone'

/**
 * Shows the app in the person's Twake Workplace language, theme and timezone,
 * falling back to the browser's for any they never chose.
 */
export function FollowSettings({
  children
}: {
  children: ReactNode
}): ReactElement | null {
  const { lang: browserLang } = useI18n()
  const { setMode } = useColorScheme()
  const { data, isPending } = useSettings()
  const api = usePagesApi()
  const queryClient = useQueryClient()

  // Without settings held, the first read failed or is still under way and may
  // predate this version: read again.
  useEffect(
    () =>
      api.watchSettings(version => {
        const shown = queryClient.getQueryData<UserSettings>(settingsKey)
        if (!shown || version > shown.version) {
          void queryClient.invalidateQueries({ queryKey: settingsKey })
        }
      }),
    [api, queryClient]
  )

  const theme = data?.theme
  useEffect(() => {
    if (theme) setMode(theme === 'auto' ? 'system' : theme)
  }, [theme, setMode])

  if (isPending) return null
  followZone(data?.timezone ?? null)
  const lang = resolveLanguage([data?.language, browserLang])
  return (
    <I18nProvider lang={lang}>
      <PickersProvider lang={lang}>{children}</PickersProvider>
    </I18nProvider>
  )
}
