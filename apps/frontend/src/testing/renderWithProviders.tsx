import type { SpaceOverlay } from '@linagora/twake-mui'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import {
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider
} from 'react-router'

import type { PagesApi } from '@/application/pages'
import type { SessionService } from '@/application/session'
import { AppProviders } from '@/app/AppProviders'
import { makeQueryClient } from '@/app/queryClient'
import { routes } from '@/app/routes'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { fakeSession } from '@/testing/fakeSession'
import type { SupportedLanguage } from '@/ui/i18n/languages'
import { PagesApiProvider } from '@/ui/PagesApiProvider'
import { SessionGate } from '@/ui/session/SessionGate'

interface Options {
  lang?: SupportedLanguage
  session?: SessionService
  pagesApi?: PagesApi
  /** The overlay of TwakeSpace, for a view framed there */
  overlay?: SpaceOverlay | null
}

export function renderWithProviders(
  ui: ReactElement,
  {
    lang = 'en',
    session = fakeSession(),
    pagesApi = fakePagesApi(),
    overlay = null
  }: Options = {}
): RenderResult {
  return render(
    <AppProviders lang={lang} queryClient={makeQueryClient()} overlay={overlay}>
      <SessionGate session={session}>
        <PagesApiProvider api={pagesApi}>{ui}</PagesApiProvider>
      </SessionGate>
    </AppProviders>
  )
}

export function renderRoute(
  path: string,
  options: Options = {}
): RenderResult & { router: ReturnType<typeof createMemoryRouter> } {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return {
    ...renderWithProviders(<RouterProvider router={router} />, options),
    router
  }
}

/** Routes the real browser history: the URL of the page is the route. */
export function renderBrowserRoute(
  options: Options = {}
): RenderResult & { router: ReturnType<typeof createBrowserRouter> } {
  const router = createBrowserRouter(routes)
  return {
    ...renderWithProviders(<RouterProvider router={router} />, options),
    router
  }
}
