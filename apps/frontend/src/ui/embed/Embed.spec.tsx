import type { SpaceOverlay } from '@linagora/twake-mui'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
  type MockInstance
} from 'vitest'

import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderBrowserRoute, renderRoute } from '@/testing/renderWithProviders'
import { connectTwakeSpace, disconnectTwakeSpace } from '@/ui/embed/twakeSpace'

const SPACE = 'https://space.example.com'

beforeEach(() => {
  window.TWAKE_SPACE_ORIGIN = `${SPACE} http://localhost:3000`
})

afterEach(() => {
  delete window.TWAKE_SPACE_ORIGIN
  vi.restoreAllMocks()
})

/**
 * The overlay page TwakeSpace frames over its whole page, on the app's
 * origin, once found: its body is where the overlay draws.
 */
function overlayOfTwakeSpace(): { overlay: SpaceOverlay; body: HTMLElement } {
  const frame = document.body.appendChild(document.createElement('iframe'))
  onTestFinished(() => {
    frame.remove()
  })
  const body = frame.contentDocument?.body
  if (!body) throw new Error('The overlay has no body')
  return {
    overlay: {
      getStatus: () => 'connected',
      getBody: () => body,
      subscribe: () => () => undefined
    },
    body
  }
}

describe('the embedded view', () => {
  it("shows the wiki, without the app's bar and navigation", async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ kind: 'space' })
    renderRoute(`/embed/wikis/${wiki.id}`, { pagesApi })

    expect(
      await screen.findByRole('navigation', { name: 'Wiki' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Wikis' })
    ).not.toBeInTheDocument()
  })

  it("draws the wiki's dialogs on the overlay of TwakeSpace, and a menu beside its button in the frame", async () => {
    const { overlay, body } = overlayOfTwakeSpace()
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ kind: 'space' })
    renderRoute(`/embed/wikis/${wiki.id}`, { pagesApi, overlay })

    fireEvent.click(await screen.findByRole('button', { name: 'Wiki options' }))
    // The frame cannot tell where it sits on the page of TwakeSpace
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))

    expect(
      within(body).getByRole('dialog', { name: 'Edit wiki' })
    ).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('the history of the embedded view', () => {
  const OTHER = 'http://localhost:3000'
  let frame: HTMLIFrameElement
  let space: Window
  let post: MockInstance<Window['postMessage']>

  const pathMessages = () =>
    post.mock.calls
      .map(([message]) => message as { type: string })
      .filter(message => message.type === 'twake-embed:path')
  const tell = (data: unknown, origin = SPACE) => {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          origin,
          source: space
        })
      )
    })
  }

  // Like TwakeSpace, waits for the first path the app reports: the view shows
  // before the effect that listens to TwakeSpace has run.
  async function renderEmbed(path: string, pagesApi = fakePagesApi()) {
    window.history.replaceState(null, '', path)
    connectTwakeSpace(space)
    const { router } = renderBrowserRoute({ pagesApi })
    await waitFor(() => {
      expect(pathMessages()).not.toEqual([])
    })
    return router
  }

  beforeEach(() => {
    // jsdom's parent is the window itself: a frame stands for TwakeSpace
    frame = document.body.appendChild(document.createElement('iframe'))
    const { contentWindow } = frame
    if (contentWindow === null) throw new Error('The frame has no window')
    space = contentWindow
    post = vi.spyOn(space, 'postMessage')
  })

  afterEach(() => {
    disconnectTwakeSpace()
    frame.remove()
    window.history.replaceState(null, '', '/')
  })

  it('reports the first path as a replace', async () => {
    await renderEmbed('/embed/wikis/w1/pages/p1')

    expect(post).toHaveBeenCalledWith(
      {
        type: 'twake-embed:path',
        resourceId: 'w1',
        path: '/pages/p1',
        replace: true
      },
      SPACE
    )
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'twake-embed:path' }),
      OTHER
    )
  })

  it('reports a navigation of the app as a push that adds no entry', async () => {
    const router = await renderEmbed('/embed/wikis/w1')
    const length = window.history.length
    post.mockClear()

    await act(() => router.navigate('/embed/wikis/w1/pages/p2'))

    expect(window.location.pathname).toBe('/embed/wikis/w1/pages/p2')
    expect(window.history.length).toBe(length)
    expect(pathMessages()).toContainEqual({
      type: 'twake-embed:path',
      resourceId: 'w1',
      path: '/pages/p2',
      replace: false
    })
  })

  it('reports the page, the search and the trash the person opens, below the route of the wiki', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ kind: 'space' })
    const page = pagesApi.withPage(wiki.id, { title: 'Roadmap' })
    await renderEmbed(`/embed/wikis/${wiki.id}`, pagesApi)
    const reportedAt = async (path: string) => {
      await waitFor(() => {
        expect(pathMessages().at(-1)).toEqual({
          type: 'twake-embed:path',
          resourceId: wiki.id,
          path,
          replace: false
        })
      })
    }

    fireEvent.click(await screen.findByRole('treeitem', { name: 'Roadmap' }))
    await reportedAt(`/pages/${page.id}`)
    fireEvent.click(screen.getByRole('link', { name: 'Search' }))
    await reportedAt('/search')
    fireEvent.click(screen.getByRole('link', { name: 'Trash' }))
    await reportedAt('/trash')
  })

  it('shows another wiki on load, without reporting it', async () => {
    const router = await renderEmbed('/embed/wikis/w1')
    post.mockClear()

    tell({ type: 'twake-embed:load', resourceId: 'w2', path: '' })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/embed/wikis/w2')
    })
    expect(pathMessages()).toEqual([])
  })

  it('goes to a path of the shown wiki on navigate', async () => {
    const router = await renderEmbed('/embed/wikis/w1')
    post.mockClear()

    tell({
      type: 'twake-embed:navigate',
      resourceId: 'w1',
      path: '/pages/p3'
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/embed/wikis/w1/pages/p3')
    })
    expect(pathMessages()).toEqual([])
  })

  it('drops a navigate meant for another wiki', async () => {
    const router = await renderEmbed('/embed/wikis/w1')

    tell({ type: 'twake-embed:navigate', resourceId: 'w2', path: '' })

    expect(router.state.location.pathname).toBe('/embed/wikis/w1')
  })

  it('ignores other origins and windows, and paths that leave the embed route', async () => {
    const router = await renderEmbed('/embed/wikis/w1')

    tell(
      { type: 'twake-embed:load', resourceId: 'w2', path: '' },
      'https://evil.example.com'
    )
    for (const path of ['//evil.test', '/../../wikis', 'wikis', 3]) {
      tell({ type: 'twake-embed:load', resourceId: 'w1', path })
    }
    tell({ type: 'twake-embed:load', resourceId: '../x', path: '' })
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'twake-embed:load', resourceId: 'w2', path: '' },
          origin: SPACE,
          source: window
        })
      )
    })

    expect(router.state.location.pathname).toBe('/embed/wikis/w1')
  })
})
