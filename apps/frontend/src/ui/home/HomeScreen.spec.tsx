import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi, type FakePagesApi } from '@/testing/fakePagesApi'
import { typeIn } from '@/testing/forms'
import { renderRoute } from '@/testing/renderWithProviders'

async function openNewWiki(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'New wiki' }))
  return screen.getByRole('dialog', { name: 'New wiki' })
}

const titlesIn = (list: HTMLElement) =>
  within(list)
    .getAllByRole('link')
    .map(link => link.textContent)

describe('HomeScreen', () => {
  it('welcomes to Twake Pages', async () => {
    renderRoute('/')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Twake Pages' })
    ).toBeVisible()
    await waitFor(() => {
      expect(document.title).toBe('Twake Pages')
    })
  })

  it('says when there is no wiki yet', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.listWikis.mockResolvedValue([])
    renderRoute('/', { pagesApi })

    expect(await findEmptyState('No wikis yet')).toHaveTextContent(
      'The wikis shared with you will show here.'
    )
  })

  it('lists the wikis, the personal one first', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.withWiki({ name: 'Onboarding' })
    pagesApi.withWiki({ name: 'Handbook' })
    renderRoute('/', { pagesApi })

    const list = await screen.findByRole('list', { name: 'Wikis' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['Personal', 'Handbook', 'Onboarding'])
  })

  it('shows the personal wiki under a label in the language of the person', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.withWiki({ name: 'Manuel' })
    renderRoute('/', { lang: 'fr', pagesApi })

    const list = await screen.findByRole('list', { name: 'Wikis' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['Personnel', 'Manuel'])
  })

  it('opens a wiki from the list', async () => {
    const pagesApi = fakePagesApi()
    const handbook = pagesApi.withWiki({ name: 'Handbook' })
    const { router } = renderRoute('/', { pagesApi })

    fireEvent.click(await screen.findByRole('link', { name: 'Handbook' }))

    expect(router.state.location.pathname).toBe(`/wikis/${handbook.id}`)
  })

  it('says so when the wikis cannot be loaded', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.listWikis.mockRejectedValue(new ApiError(403, null))
    renderRoute('/', { pagesApi })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The wikis could not be loaded.'
    )
  })
})

describe('a new wiki', () => {
  it('opens on its home page, under its name and description', async () => {
    const pagesApi = fakePagesApi()
    const { router } = renderRoute('/', { pagesApi })

    const dialog = await openNewWiki()
    typeIn(dialog, 'Name', ' Engineering ')
    typeIn(dialog, 'Description', ' How we build\n')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Engineering' })
    ).toBeVisible()
    expect(screen.getByText('How we build')).toBeVisible()
    // The name trimmed, the description as typed.
    expect(pagesApi.createWiki).toHaveBeenCalledWith({
      name: 'Engineering',
      description: ' How we build\n'
    })
    expect(router.state.location.pathname).toMatch(/^\/wikis\/[^/]+$/)
  })

  it('needs no description', async () => {
    const pagesApi = fakePagesApi()
    renderRoute('/', { pagesApi })

    const dialog = await openNewWiki()
    typeIn(dialog, 'Name', 'Engineering')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Engineering' })
    ).toBeVisible()
    expect(pagesApi.createWiki).toHaveBeenCalledWith({
      name: 'Engineering',
      description: ''
    })
  })

  it('needs a name', async () => {
    renderRoute('/')

    const dialog = await openNewWiki()
    const create = within(dialog).getByRole('button', { name: 'Create' })
    expect(create).toBeDisabled()

    typeIn(dialog, 'Name', '   ')

    expect(create).toBeDisabled()
  })

  it('says so when it cannot be created', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.createWiki.mockRejectedValue(new ApiError(400, 'invalid_request'))
    renderRoute('/', { pagesApi })

    const dialog = await openNewWiki()
    typeIn(dialog, 'Name', 'Engineering')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The wiki could not be saved.'
    )
  })

  it('is not made when the dialog is closed', async () => {
    const pagesApi = fakePagesApi()
    renderRoute('/', { pagesApi })

    const dialog = await openNewWiki()
    typeIn(dialog, 'Name', 'Engineering')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(pagesApi.createWiki).not.toHaveBeenCalled()
  })
})

describe('favorites and recent pages', () => {
  it('lists the favorites, the last marked first, each with its wiki', async () => {
    const pagesApi = fakePagesApi()
    const personal = pagesApi.withWiki({ kind: 'personal' })
    const handbook = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(handbook.id, { title: 'Plans' })
    const ideas = pagesApi.withPage(personal.id, { title: 'Ideas' })
    await pagesApi.setFavorite(plans.id, true)
    await pagesApi.setFavorite(ideas.id, true)
    renderRoute('/', { pagesApi })

    const favorites = await screen.findByRole('list', { name: 'Favorites' })
    expect(titlesIn(favorites)).toEqual(['Ideas', 'Plans'])
    expect(
      within(favorites).getByRole('listitem', { name: 'Plans' })
    ).toHaveTextContent('Handbook')
  })

  it('lists the pages opened lately, the last one first, each with its wiki', async () => {
    const pagesApi = fakePagesApi()
    const handbook = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(handbook.id, { title: 'Plans' })
    const goals = pagesApi.withPage(handbook.id, { title: 'Goals' })
    await pagesApi.getPage(plans.id)
    await pagesApi.getPage(goals.id)
    renderRoute('/', { pagesApi })

    const recent = await screen.findByRole('list', { name: 'Recent' })
    expect(titlesIn(recent)).toEqual(['Goals', 'Plans'])
    expect(
      within(recent).getByRole('listitem', { name: 'Goals' })
    ).toHaveTextContent('Handbook')
  })

  it('names the personal wiki of a page in the language of the person', async () => {
    const pagesApi = fakePagesApi()
    const personal = pagesApi.withWiki({ kind: 'personal' })
    const ideas = pagesApi.withPage(personal.id, { title: 'Idées' })
    await pagesApi.setFavorite(ideas.id, true)
    renderRoute('/', { lang: 'fr', pagesApi })

    const favorites = await screen.findByRole('list', { name: 'Favoris' })
    expect(
      within(favorites).getByRole('listitem', { name: 'Idées' })
    ).toHaveTextContent('Personnel')
  })

  it('shows a home page under the name of its wiki, which opens on it', async () => {
    const pagesApi = fakePagesApi()
    const personal = pagesApi.withWiki({ kind: 'personal' })
    await pagesApi.getPage(personal.homePageId)
    const { router } = renderRoute('/', { lang: 'fr', pagesApi })

    const recent = await screen.findByRole('list', { name: 'Récents' })
    expect(
      within(recent).getByRole('listitem', { name: 'Personnel' })
    ).toHaveTextContent("Page d'accueil")
    fireEvent.click(within(recent).getByRole('link', { name: 'Personnel' }))

    expect(router.state.location.pathname).toBe(`/wikis/${personal.id}`)
  })

  it('opens a page from its shelf', async () => {
    const pagesApi = fakePagesApi()
    const handbook = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(handbook.id, { title: 'Plans' })
    await pagesApi.setFavorite(plans.id, true)
    const { router } = renderRoute('/', { pagesApi })

    const favorites = await screen.findByRole('list', { name: 'Favorites' })
    fireEvent.click(within(favorites).getByRole('link', { name: 'Plans' }))

    expect(router.state.location.pathname).toBe(
      `/wikis/${handbook.id}/pages/${plans.id}`
    )
  })

  it.each([
    {
      none: 'Favorites',
      shown: 'Recent',
      keep: (pagesApi: FakePagesApi, pageId: string) => pagesApi.getPage(pageId)
    },
    {
      none: 'Recent',
      shown: 'Favorites',
      keep: (pagesApi: FakePagesApi, pageId: string) =>
        pagesApi.setFavorite(pageId, true)
    }
  ])('shows no $none while there is none', async ({ none, shown, keep }) => {
    const pagesApi = fakePagesApi()
    const handbook = pagesApi.withWiki({ name: 'Handbook' })
    const plans = pagesApi.withPage(handbook.id, { title: 'Plans' })
    await keep(pagesApi, plans.id)
    renderRoute('/', { pagesApi })

    await screen.findByRole('list', { name: shown })
    expect(screen.queryByRole('list', { name: none })).not.toBeInTheDocument()
  })

  it.each([
    {
      what: 'favorites',
      list: 'favorites',
      alert: 'The favorites could not be loaded.',
      shown: 'Recent'
    },
    {
      what: 'recent pages',
      list: 'recent',
      alert: 'The recent pages could not be loaded.',
      shown: 'Favorites'
    }
  ] as const)(
    'says so when the $what cannot be loaded',
    async ({ list, alert, shown }) => {
      const pagesApi = fakePagesApi()
      const handbook = pagesApi.withWiki({ name: 'Handbook' })
      const plans = pagesApi.withPage(handbook.id, { title: 'Plans' })
      await pagesApi.setFavorite(plans.id, true)
      await pagesApi.getPage(plans.id)
      pagesApi[list].mockRejectedValue(new ApiError(403, null))
      renderRoute('/', { pagesApi })

      expect(await screen.findByRole('alert')).toHaveTextContent(alert)
      expect(
        titlesIn(await screen.findByRole('list', { name: shown }))
      ).toEqual(['Plans'])
    }
  )
})
