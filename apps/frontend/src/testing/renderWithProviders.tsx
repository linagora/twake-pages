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
import type { ImageSources } from '@/domain/images'
import { blockNoteChunk } from '@/ds/blockNoteChunk'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { fakeSession } from '@/testing/fakeSession'
import type { SupportedLanguage } from '@/ui/i18n/languages'
import { ImageSourcesProvider } from '@/ui/ImageSourcesProvider'
import { PagesApiProvider } from '@/ui/PagesApiProvider'
import { SessionGate } from '@/ui/session/SessionGate'

// BlockNote loads in its own chunk the first time a page shows its blocks.
// Loaded with these helpers, its import stays out of the time findBy waits.
await Promise.all(Object.values(blockNoteChunk).map(load => load()))

interface Options {
  lang?: SupportedLanguage
  session?: SessionService
  pagesApi?: PagesApi
  /** Where the app shows images from: by default, its own origin only. */
  imageSources?: ImageSources
  /** The overlay of TwakeSpace, for a view framed there */
  overlay?: SpaceOverlay | null
}

export function renderWithProviders(
  ui: ReactElement,
  {
    lang = 'en',
    session = fakeSession(),
    pagesApi = fakePagesApi(),
    imageSources = { self: window.location.origin, added: [] },
    overlay = null
  }: Options = {}
): RenderResult {
  return render(
    <AppProviders lang={lang} queryClient={makeQueryClient()} overlay={overlay}>
      <SessionGate session={session}>
        <PagesApiProvider api={pagesApi}>
          <ImageSourcesProvider sources={imageSources}>
            {ui}
          </ImageSourcesProvider>
        </PagesApiProvider>
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
