import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Role } from '@/domain/wiki'
import { findAppSearch } from '@/testing/appSearch'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi, paragraph } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

const BOB = 'bob@example.com'

/**
 * Alice's Handbook, which she runs with `members`, whose "Onboarding" tells
 * to bring a badge.
 */
function handbook(members: Record<string, Role> = {}) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Handbook', members })
  const onboarding = pagesApi.withPage(wiki.id, {
    title: 'Onboarding',
    content: [paragraph('Bring your badge on the first day.')]
  })
  return { pagesApi, wiki, onboarding }
}

/** The results shown for `text`, once found. */
const resultsFor = async (text: string) =>
  within(await screen.findByRole('region', { name: `Results for “${text}”` }))

/** The search field of a wiki's own search. */
const wikiSearch = () =>
  screen.findByRole('searchbox', { name: 'Search this wiki' })

/** The search of every wiki and that of one wiki, each by its address. */
const searches: [string, (wikiId: string) => string][] = [
  ['every wiki', () => '/search'],
  ['one wiki', wikiId => `/wikis/${wikiId}/search`]
]

describe('SearchScreen', () => {
  it('lists the pages found in every wiki, the best first, each with its wiki', async () => {
    const { pagesApi, wiki, onboarding } = handbook()
    const guide = pagesApi.withWiki({ name: 'Guide' })
    pagesApi.withPage(guide.id, { title: 'Badges' })
    renderRoute('/search?q=badge', { pagesApi })

    const results = await resultsFor('badge')
    expect(
      results
        .getAllByRole('listitem')
        .map(result => result.getAttribute('aria-label'))
    ).toEqual(['Badges', 'Onboarding'])
    expect(results.getByRole('listitem', { name: 'Badges' })).toHaveTextContent(
      'Guide'
    )
    expect(
      results.getByRole('listitem', { name: 'Onboarding' })
    ).toHaveTextContent('Handbook')
    expect(results.getByRole('link', { name: 'Onboarding' })).toHaveAttribute(
      'href',
      `/wikis/${wiki.id}/pages/${onboarding.id}`
    )
    expect(
      screen.getByRole('heading', { level: 1, name: 'Search' })
    ).toBeVisible()
  })

  it('quotes the text around the words found, highlighted, as text', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    pagesApi.withPage(wiki.id, {
      title: 'Markup',
      content: [
        paragraph('Wrap a <b>badge</b> in bold, then badges in italics.')
      ]
    })
    renderRoute('/search?q=badge', { pagesApi })

    const result = (await resultsFor('badge')).getByRole('listitem', {
      name: 'Markup'
    })
    expect(result).toHaveTextContent(
      'Wrap a <b>badge</b> in bold, then badges in italics.'
    )
    expect(
      [...result.querySelectorAll('mark')].map(mark => mark.textContent)
    ).toEqual(['badge', 'badges'])
    expect(result.querySelector('b')).toBeNull()
  })

  it('highlights the words found in the title, as text', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    pagesApi.withPage(wiki.id, { title: 'Badge <b>rules</b> and badges' })
    renderRoute('/search?q=badge', { pagesApi })

    const link = (await resultsFor('badge')).getByRole('link', {
      name: 'Badge <b>rules</b> and badges'
    })
    expect(
      [...link.querySelectorAll('mark')].map(mark => mark.textContent)
    ).toEqual(['Badge', 'badges'])
    expect(link.querySelector('b')).toBeNull()
  })

  it('opens the page of a result', async () => {
    const { pagesApi, wiki, onboarding } = handbook()
    const { router } = renderRoute('/search?q=badge', { pagesApi })

    fireEvent.click(
      (await resultsFor('badge')).getByRole('link', { name: 'Onboarding' })
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    ).toBeVisible()
    expect(router.state.location.pathname).toBe(
      `/wikis/${wiki.id}/pages/${onboarding.id}`
    )
  })

  it.each(searches)(
    'shows a home page under the name of its wiki, which opens on it, in the search of %s',
    async (_search, addressOf) => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({ name: 'Handbook' })
      await pagesApi.publish(wiki.homePageId, {
        baseVersion: 1,
        title: 'Welcome',
        content: [paragraph('Wear your badge at all times.')]
      })
      const { router } = renderRoute(`${addressOf(wiki.id)}?q=badge`, {
        pagesApi
      })

      const results = await resultsFor('badge')
      expect(
        results.getByRole('listitem', { name: 'Handbook' })
      ).toHaveTextContent('Home page')
      fireEvent.click(results.getByRole('link', { name: 'Handbook' }))

      expect(router.state.location.pathname).toBe(`/wikis/${wiki.id}`)
    }
  )

  it("highlights the title of a home page only when it is its wiki's name", async () => {
    const pagesApi = fakePagesApi()
    pagesApi.withWiki({ name: 'Badges' })
    const wiki = pagesApi.withWiki({ name: 'Handbook' })
    await pagesApi.publish(wiki.homePageId, {
      baseVersion: 1,
      title: 'Badge office',
      content: [paragraph('Ask at the front desk.')]
    })
    renderRoute('/search?q=badge', { pagesApi })

    const results = await resultsFor('badge')
    expect(
      results.getByRole('link', { name: 'Badges' }).querySelector('mark')
    ).toHaveTextContent('Badges')
    expect(
      results.getByRole('link', { name: 'Handbook' }).querySelector('mark')
    ).toBeNull()
  })

  it('names the personal wiki of a page in the language of the person', async () => {
    const pagesApi = fakePagesApi()
    const personal = pagesApi.withWiki({ kind: 'personal' })
    pagesApi.withPage(personal.id, {
      title: 'Idées',
      content: [paragraph('Un badge pour chacun')]
    })
    renderRoute('/search?q=badge', { lang: 'fr', pagesApi })

    const results = within(
      await screen.findByRole('region', { name: 'Résultats pour « badge »' })
    )
    expect(results.getByRole('listitem', { name: 'Idées' })).toHaveTextContent(
      'Personnel'
    )
  })

  it('says when no page matches', async () => {
    renderRoute('/search?q=zebra', { pagesApi: handbook().pagesApi })

    expect(await findEmptyState('No pages match')).toHaveTextContent(
      'Try another word, or check the spelling.'
    )
  })

  it.each(searches)(
    'says so when the search of %s fails',
    async (_search, addressOf) => {
      const { pagesApi, wiki } = handbook()
      pagesApi.search.mockRejectedValue(new ApiError(400, 'invalid_request'))
      renderRoute(`${addressOf(wiki.id)}?q=badge`, { pagesApi })

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'The pages could not be searched.'
      )
    }
  )

  it('searches nothing without words', async () => {
    const { pagesApi } = handbook()
    renderRoute('/search?q=%20', { pagesApi })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Search' })
    ).toBeVisible()
    expect(pagesApi.search).not.toHaveBeenCalled()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('the search of the app bar', () => {
  it('searches every wiki for the words typed', async () => {
    const { pagesApi } = handbook()
    const { router } = renderRoute('/', { pagesApi })

    fireEvent.change(await findAppSearch(), { target: { value: ' badge ' } })
    const reloads = fireEvent.submit(
      screen.getByRole('search', { name: 'Search' })
    )

    expect(reloads).toBe(false)
    expect(
      (await resultsFor('badge')).getByRole('listitem', { name: 'Onboarding' })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/search')
    expect(router.state.location.search).toBe('?q=badge')
    expect(pagesApi.search).toHaveBeenCalledWith('badge')
  })

  it('keeps the words searched in its field', async () => {
    renderRoute('/search?q=badge', { pagesApi: handbook().pagesApi })

    expect(await findAppSearch()).toHaveValue('badge')
  })

  it('empties its field when leaving the search', async () => {
    renderRoute('/search?q=badge', { pagesApi: handbook().pagesApi })
    const field = await findAppSearch()

    fireEvent.click(screen.getByRole('link', { name: 'Twake Pages' }))

    await waitFor(() => {
      expect(field).toHaveValue('')
    })
  })

  it("leaves the words of a wiki's search to the wiki", async () => {
    const { pagesApi, wiki } = handbook()
    renderRoute(`/wikis/${wiki.id}/search?q=badge`, { pagesApi })

    expect(await findAppSearch()).toHaveValue('')
  })
})

describe("a wiki's search", () => {
  it('searches the wiki alone for the words typed in its own field', async () => {
    const { pagesApi, wiki } = handbook()
    const guide = pagesApi.withWiki({ name: 'Guide' })
    pagesApi.withPage(guide.id, { title: 'Badges' })
    const { router } = renderRoute(`/wikis/${wiki.id}/search`, { pagesApi })

    fireEvent.change(await wikiSearch(), { target: { value: ' badge ' } })
    fireEvent.submit(screen.getByRole('search', { name: 'Search this wiki' }))

    const results = await resultsFor('badge')
    expect(
      results
        .getAllByRole('listitem')
        .map(result => result.getAttribute('aria-label'))
    ).toEqual(['Onboarding'])
    expect(router.state.location.pathname).toBe(`/wikis/${wiki.id}/search`)
    expect(router.state.location.search).toBe('?q=badge')
    expect(pagesApi.search).toHaveBeenCalledWith('badge', wiki.id)
    expect(
      screen.getByRole('heading', { level: 1, name: 'Search this wiki' })
    ).toBeVisible()
  })

  it('keeps the words searched in its field', async () => {
    const { pagesApi, wiki } = handbook()
    renderRoute(`/wikis/${wiki.id}/search?q=badge`, { pagesApi })

    expect(await wikiSearch()).toHaveValue('badge')
  })

  it('opens the pages found inside the frame of TwakeSpace', async () => {
    const { pagesApi, wiki, onboarding } = handbook()
    const { router } = renderRoute(`/embed/wikis/${wiki.id}/search?q=badge`, {
      pagesApi
    })

    fireEvent.click(
      (await resultsFor('badge')).getByRole('link', { name: 'Onboarding' })
    )

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    ).toBeVisible()
    expect(router.state.location.pathname).toBe(
      `/embed/wikis/${wiki.id}/pages/${onboarding.id}`
    )
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
  })

  it('drops a page that another member sends to the trash', async () => {
    const { pagesApi, wiki, onboarding } = handbook({ [BOB]: 'editor' })
    pagesApi.withPage(wiki.id, { title: 'Badges' })
    const bob = pagesApi.signedInAs(BOB)
    renderRoute(`/wikis/${wiki.id}/search?q=badge`, { pagesApi })
    expect(
      (await resultsFor('badge')).getByRole('listitem', { name: 'Onboarding' })
    ).toBeInTheDocument()

    await act(() => bob.deletePage(onboarding.id))

    await waitFor(() => {
      expect(
        screen.queryByRole('listitem', { name: 'Onboarding' })
      ).not.toBeInTheDocument()
    })
    expect(
      (await resultsFor('badge')).getByRole('listitem', { name: 'Badges' })
    ).toBeInTheDocument()
  })
})
