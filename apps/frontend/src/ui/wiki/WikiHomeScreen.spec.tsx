import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

describe('WikiHomeScreen', () => {
  it('shows the wiki under its name, with what it is for', async () => {
    const pagesApi = fakePagesApi()
    const wiki = await pagesApi.createWiki({
      name: 'Handbook',
      description: 'How we work together'
    })
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Handbook' })
    ).toBeVisible()
    expect(screen.getByText('How we work together')).toBeVisible()
    await waitFor(() => {
      expect(document.title).toBe('Handbook - Twake Pages')
    })
  })

  it('shows the personal wiki under its label, in the language of the person', async () => {
    const pagesApi = fakePagesApi()
    const personal = pagesApi.withWiki({ kind: 'personal' })
    renderRoute(`/wikis/${personal.id}`, { lang: 'fr', pagesApi })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Personnel' })
    ).toBeVisible()
  })
})
