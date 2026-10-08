import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

async function openNewWiki(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole('button', { name: 'New wiki' }))
  return screen.getByRole('dialog', { name: 'New wiki' })
}

function typeIn(dialog: HTMLElement, field: string, value: string): void {
  fireEvent.change(within(dialog).getByRole('textbox', { name: field }), {
    target: { value }
  })
}

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
    typeIn(dialog, 'Description', 'How we build')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Engineering' })
    ).toBeVisible()
    expect(screen.getByText('How we build')).toBeVisible()
    expect(pagesApi.createWiki).toHaveBeenCalledWith({
      name: 'Engineering',
      description: 'How we build'
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
      'The wiki could not be created.'
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
