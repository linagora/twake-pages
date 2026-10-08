import { SdkProvider, TwakeBar, type TwakeBarSlots } from '@linagora/twake-bar'
import type { Sdk } from '@linagora/twake-sdk'
import type { ReactElement } from 'react'

import pagesIcon from '@/assets/pages.svg'
import { useI18n } from '@/ui/i18n/useI18n'
import { useSession } from '@/ui/session/SessionGate'

/**
 * The platform top bar: home, the other apps and the account. Shown once the
 * SSO named the user's platform, which exchanges the id token for its own.
 */
export function PlatformBar({
  sdk,
  slots
}: {
  sdk: Sdk
  slots: TwakeBarSlots
}): ReactElement {
  const { t } = useI18n()
  const { signOut } = useSession()

  return (
    <SdkProvider client={sdk}>
      <TwakeBar
        app={{
          slug: 'pages',
          name: t('app.name'),
          icon: new URL(pagesIcon, window.location.origin).href
        }}
        slots={slots}
        onLogOut={() => void signOut()}
      />
    </SdkProvider>
  )
}
