import { useState, type ReactElement } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'

import type { PagesApi } from '@/application/pages'
import type { SessionService } from '@/application/session'
import type { SpaceOverlay } from '@linagora/twake-mui'
import { AppProviders } from '@/app/AppProviders'
import { makeQueryClient } from '@/app/queryClient'
import { routes } from '@/app/routes'
import { findPreferredLanguage } from '@/ui/i18n/languages'
import { PagesApiProvider } from '@/ui/PagesApiProvider'
import { SessionGate } from '@/ui/session/SessionGate'
import { FollowSettings } from '@/ui/settings/FollowSettings'

export interface AppProps {
  session: SessionService
  pagesApi: PagesApi
  overlay?: SpaceOverlay | null
}

export function App({
  session,
  pagesApi,
  overlay = null
}: AppProps): ReactElement {
  const [queryClient] = useState(makeQueryClient)
  const [lang] = useState(findPreferredLanguage)

  return (
    <AppProviders lang={lang} queryClient={queryClient} overlay={overlay}>
      <SessionGate session={session}>
        <PagesApiProvider api={pagesApi}>
          <FollowSettings>
            <AppRouter />
          </FollowSettings>
        </PagesApiProvider>
      </SessionGate>
    </AppProviders>
  )
}

// Created once signed in: the sign-in may move the browser off the redirect URI
function AppRouter(): ReactElement {
  const [router] = useState(() => createBrowserRouter(routes))
  return <RouterProvider router={router} />
}
