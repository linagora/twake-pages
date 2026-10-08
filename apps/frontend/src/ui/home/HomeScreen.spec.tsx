import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

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
