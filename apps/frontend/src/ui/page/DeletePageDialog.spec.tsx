import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { engineering } from '@/testing/engineering'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

/** Opens the dialog that deletes the open page, once the tree shows. */
async function openDelete(title: string): Promise<HTMLElement> {
  await screen.findByRole('tree', { name: 'Pages' })
  fireEvent.click(await screen.findByRole('button', { name: 'Page options' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
  return screen.getByRole('dialog', { name: `Delete ${title}?` })
}

const treeItem = (title: string) =>
  screen.queryByRole('treeitem', { name: title })

describe('a page deleted from its menu', () => {
  it('goes to the trash once sure, and the screen to its parent', async () => {
    const { pagesApi, laptop } = engineering()
    const dialog = await openDelete('Laptop setup')
    expect(dialog).toHaveTextContent(
      'It goes to the trash with any child pages, for every member, and is deleted for good after 30 days.'
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    ).toBeVisible()
    await waitFor(() => {
      expect(treeItem('Laptop setup')).not.toBeInTheDocument()
    })
    expect(treeItem('First week')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pagesApi.deletePage).toHaveBeenCalledWith(laptop.id)
  })

  it('takes its child pages along, and the screen to the home page from the top of the tree', async () => {
    const { pagesApi, onboarding } = engineering('Onboarding')
    const dialog = await openDelete('Onboarding')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Engineering' })
    ).toBeVisible()
    await waitFor(() => {
      expect(treeItem('Onboarding')).not.toBeInTheDocument()
    })
    expect(treeItem('Laptop setup')).not.toBeInTheDocument()
    expect(treeItem('Releases')).toBeInTheDocument()
    expect(pagesApi.deletePage).toHaveBeenCalledWith(onboarding.id)
  })

  it('leaves no dialog open on a parent read before', async () => {
    engineering()
    fireEvent.click(await screen.findByRole('treeitem', { name: 'Onboarding' }))
    await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    fireEvent.click(screen.getByRole('treeitem', { name: 'Laptop setup' }))
    await screen.findByRole('heading', { level: 1, name: 'Laptop setup' })
    const dialog = await openDelete('Laptop setup')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    ).toBeVisible()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('goes to its parent when the stream tells the page deleted before its answer does', async () => {
    const { pagesApi } = engineering()
    const deletePage = pagesApi.deletePage.getMockImplementation()
    let answer = (): void => undefined
    pagesApi.deletePage.mockImplementationOnce(async pageId => {
      await deletePage?.(pageId)
      await new Promise<void>(resolve => {
        answer = resolve
      })
    })
    const dialog = await openDelete('Laptop setup')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('This page is in the trash.')).toBeVisible()
    act(() => {
      answer()
    })

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Onboarding' })
    ).toBeVisible()
  })

  it('stays in the tree when not sure', async () => {
    const { pagesApi } = engineering()
    const dialog = await openDelete('Laptop setup')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(pagesApi.deletePage).not.toHaveBeenCalled()
  })

  it('says so when it cannot be deleted', async () => {
    const { pagesApi } = engineering()
    pagesApi.deletePage.mockRejectedValue(new ApiError(409, 'in_trash'))
    const dialog = await openDelete('Laptop setup')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The page could not be deleted.'
    )
  })

  it('reads the wiki again once refused, as the tree may be behind it', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      name: 'Engineering',
      members: { 'bob@example.com': 'editor' }
    })
    const releases = pagesApi.withPage(wiki.id, { title: 'Releases' })
    // Down, so the tree still shows Releases once Bob deleted it.
    pagesApi.watchWiki.mockImplementation(() => () => undefined)
    renderRoute(`/wikis/${wiki.id}/pages/${releases.id}`, { pagesApi })
    const dialog = await openDelete('Releases')
    await pagesApi.signedInAs('bob@example.com').deletePage(releases.id)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    expect(await screen.findByText('This page is in the trash.')).toBeVisible()
    expect(treeItem('Releases')).not.toBeInTheDocument()
  })
})
