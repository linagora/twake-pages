import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'

const NOT_FOUND = "This wiki doesn't exist, or you can't open it."

/** A wiki of Bob's, with a page, which Alice is no member of. */
function wikiOfBob() {
  const pagesApi = fakePagesApi()
  const bob = pagesApi.signedInAs('bob.durand@example.com', 'Bob Durand')
  const wiki = bob.withWiki({ name: 'Board meetings' })
  const page = bob.withPage(wiki.id, { title: 'Minutes' })
  return { pagesApi, wiki, page }
}

describe('a wiki', () => {
  it.each(['', '/pages/:page'])(
    'is not found at /wikis/<wiki>%s by a person who is no member of it',
    async path => {
      const { pagesApi, wiki, page } = wikiOfBob()
      renderRoute(`/wikis/${wiki.id}${path.replace(':page', page.id)}`, {
        pagesApi
      })

      const state = await findEmptyState(NOT_FOUND)
      expect(state).toHaveTextContent(
        'The link may be broken, or the page was moved.'
      )
      expect(
        within(state).getByRole('link', { name: 'Back to wikis' })
      ).toHaveAttribute('href', '/')
      expect(
        screen.queryByRole('navigation', { name: 'Wiki' })
      ).not.toBeInTheDocument()
    }
  )

  it('closes the stream of a wiki it does not find', async () => {
    const { pagesApi, wiki } = wikiOfBob()
    let open = 0
    pagesApi.watchWiki.mockImplementation(() => {
      open += 1
      return () => {
        open -= 1
      }
    })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    await findEmptyState(NOT_FOUND)

    expect(open).toBe(0)
  })

  it('is not found inside TwakeSpace either, with no way out of the frame', async () => {
    const { pagesApi, wiki } = wikiOfBob()
    renderRoute(`/embed/wikis/${wiki.id}`, { pagesApi })

    expect(await findEmptyState(NOT_FOUND)).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: 'Back to wikis' })
    ).not.toBeInTheDocument()
  })

  it('shows placeholders while it loads', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.getWiki.mockReturnValue(new Promise(() => undefined))
    renderRoute('/wikis/any', { pagesApi })

    expect(
      await screen.findByRole('progressbar', { name: 'Loading' })
    ).toBeInTheDocument()
  })

  it('says so when it cannot be loaded', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    pagesApi.getWiki.mockRejectedValue(new ApiError(403, null))
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The wiki could not be loaded.'
    )
  })

  it.each(WIKI_BASES)(
    'opens at %s/<wiki> a wiki the person was invited to, read once their wikis are listed',
    async base => {
      const pagesApi = fakePagesApi()
      const carol = pagesApi.signedInAs('carol@example.com')
      const wiki = carol.withWiki({ name: 'Engineering' })
      await carol.invite(wiki.id, 'alice@example.com', 'editor')
      const listWikis = pagesApi.listWikis.getMockImplementation()
      let answer = (): void => undefined
      pagesApi.listWikis.mockImplementationOnce(async () => {
        await new Promise<void>(resolve => {
          answer = resolve
        })
        return (await listWikis?.()) ?? []
      })
      renderRoute(`${base}/${wiki.id}`, { pagesApi })

      expect(
        await screen.findByRole('progressbar', { name: 'Loading' })
      ).toBeInTheDocument()
      expect(pagesApi.getWiki).not.toHaveBeenCalled()
      act(() => {
        answer()
      })

      expect(
        await screen.findByRole('heading', { level: 1, name: 'Engineering' })
      ).toBeVisible()
    }
  )
})

describe('a wiki on a phone', () => {
  const matchMedia = window.matchMedia.bind(window)
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (media: string) =>
        Object.assign(matchMedia(media), {
          matches: media.includes('max-width')
        })
    })
  })
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: matchMedia
    })
  })

  it('opens on the page, with its navigation behind a menu that closes on the next page', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const kickoff = pagesApi.withPage(wiki.id, { title: 'Kickoff' })
    pagesApi.withPage(wiki.id, { title: 'Roadmap' })
    renderRoute(`/wikis/${wiki.id}/pages/${kickoff.id}`, { pagesApi })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Kickoff' })
    ).toBeVisible()
    expect(
      screen.queryByRole('navigation', { name: 'Wiki' })
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Wiki menu' }))
    const nav = await screen.findByRole('navigation', { name: 'Wiki' })
    fireEvent.click(
      await within(nav).findByRole('treeitem', { name: 'Roadmap' })
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Roadmap' })
    ).toBeVisible()
    await waitFor(() => {
      expect(
        screen.queryByRole('navigation', { name: 'Wiki' })
      ).not.toBeInTheDocument()
    })
  })

  it('closes its menu on a link to the open page, and keeps it closed going back', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    const kickoff = pagesApi.withPage(wiki.id, { title: 'Kickoff' })
    const roadmap = pagesApi.withPage(wiki.id, { title: 'Roadmap' })
    const { router } = renderRoute(`/wikis/${wiki.id}/pages/${kickoff.id}`, {
      pagesApi
    })
    await screen.findByRole('heading', { level: 1, name: 'Kickoff' })

    fireEvent.click(screen.getByRole('button', { name: 'Wiki menu' }))
    fireEvent.click(
      await within(
        await screen.findByRole('navigation', { name: 'Wiki' })
      ).findByRole('treeitem', { name: 'Kickoff' })
    )
    await waitFor(() => {
      expect(
        screen.queryByRole('navigation', { name: 'Wiki' })
      ).not.toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Wiki menu' }))
    await screen.findByRole('navigation', { name: 'Wiki' })
    await act(() => router.navigate(`/wikis/${wiki.id}/pages/${roadmap.id}`))
    await act(() => router.navigate(-1))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Kickoff' })
    ).toBeVisible()
    await waitFor(() => {
      expect(
        screen.queryByRole('navigation', { name: 'Wiki' })
      ).not.toBeInTheDocument()
    })
  })
})
