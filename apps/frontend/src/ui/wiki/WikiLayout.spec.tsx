import { act, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

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
      const answered = new Promise<void>(resolve => {
        answer = resolve
      })
      pagesApi.listWikis.mockImplementationOnce(async () => {
        await answered
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
