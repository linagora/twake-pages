import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { findEmptyState } from '@/testing/emptyState'
import { aWiki, fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

describe('HomeScreen', () => {
  it('welcomes to Twake Pages, saying there is no wiki yet', async () => {
    renderRoute('/')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Twake Pages' })
    ).toBeVisible()
    expect(await findEmptyState('No wikis yet')).toHaveTextContent(
      'The wikis shared with you will show here.'
    )
    await waitFor(() => {
      expect(document.title).toBe('Twake Pages')
    })
  })

  it('lists the wikis', async () => {
    renderRoute('/', {
      pagesApi: fakePagesApi([
        aWiki({ name: 'Handbook' }),
        aWiki({ name: 'Onboarding' })
      ])
    })

    const list = await screen.findByRole('list', { name: 'Wikis' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map(item => item.textContent)
    ).toEqual(['Handbook', 'Onboarding'])
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
