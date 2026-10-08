import { act, screen, waitFor } from '@testing-library/react'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance
} from 'vitest'

import { findEmptyState } from '@/testing/emptyState'
import { renderBrowserRoute, renderRoute } from '@/testing/renderWithProviders'
import { connectTwakeSpace, disconnectTwakeSpace } from '@/ui/embed/twakeSpace'

const SPACE = 'https://space.example.com'
const PLACEHOLDER = 'This wiki is on its way'

beforeEach(() => {
  window.TWAKE_SPACE_ORIGIN = `${SPACE} http://localhost:3000`
})

afterEach(() => {
  delete window.TWAKE_SPACE_ORIGIN
  vi.restoreAllMocks()
})

describe('the embedded view', () => {
  it("shows the wiki, without the app's navigation", async () => {
    renderRoute('/embed/wikis/w1')

    expect(await findEmptyState(PLACEHOLDER)).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
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

  async function renderEmbed(path: string) {
    window.history.replaceState(null, '', path)
    connectTwakeSpace(space)
    const { router } = renderBrowserRoute()
    await findEmptyState(PLACEHOLDER)
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
    await renderEmbed('/embed/wikis/w1?page=p1')

    await waitFor(() => {
      expect(post).toHaveBeenCalledWith(
        {
          type: 'twake-embed:path',
          resourceId: 'w1',
          path: '?page=p1',
          replace: true
        },
        SPACE
      )
    })
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'twake-embed:path' }),
      OTHER
    )
  })

  it('reports a navigation of the app as a push that adds no entry', async () => {
    const router = await renderEmbed('/embed/wikis/w1')
    const length = window.history.length
    post.mockClear()

    await act(() => router.navigate('/embed/wikis/w1?page=p2'))

    expect(window.location.search).toBe('?page=p2')
    expect(window.history.length).toBe(length)
    expect(pathMessages()).toContainEqual({
      type: 'twake-embed:path',
      resourceId: 'w1',
      path: '?page=p2',
      replace: false
    })
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
      path: '?page=p3'
    })

    await waitFor(() => {
      expect(router.state.location.search).toBe('?page=p3')
    })
    expect(router.state.location.pathname).toBe('/embed/wikis/w1')
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
