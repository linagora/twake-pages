import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

const NOT_FOUND = "This page doesn't exist, or you can't open it."

/** Engineering, then Releases under it, then the Release checklist. */
function handbook() {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Handbook' })
  const engineering = pagesApi.withPage(wiki.id, { title: 'Engineering' })
  const releases = pagesApi.withPage(wiki.id, {
    title: 'Releases',
    parentId: engineering.id
  })
  const checklist = pagesApi.withPage(wiki.id, {
    title: 'Release checklist',
    parentId: releases.id
  })
  return { pagesApi, wiki, engineering, releases, checklist }
}

const linksIn = (element: HTMLElement) =>
  within(element)
    .getAllByRole('link')
    .map(link => [link.textContent, link.getAttribute('href')])

describe('a page', () => {
  it('shows its title', async () => {
    const { pagesApi, wiki, checklist } = handbook()
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: 'Release checklist'
      })
    ).toBeVisible()
  })

  it('shows its blocks, read only', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    const checklist = pagesApi.withPage(wiki.id, {
      title: 'Release checklist',
      content: [
        { type: 'heading', content: 'Before the release' },
        { type: 'paragraph', content: 'Freeze the branch on Thursdays.' }
      ]
    })
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })

    expect(
      await screen.findByText('Freeze the branch on Thursdays.')
    ).toBeVisible()
    const main = screen.getByRole('main')
    expect(
      within(main).getByRole('heading', { name: 'Before the release' })
    ).toBeVisible()
    expect(within(main).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('says when it holds nothing yet', async () => {
    const { pagesApi, wiki, checklist } = handbook()
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })

    expect(await screen.findByText('This page is empty.')).toBeVisible()
  })

  it('shows a page in the trash under a notice', async () => {
    const { pagesApi, wiki, checklist } = handbook()
    await pagesApi.deletePage(checklist.id)
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })

    expect(await screen.findByText('This page is in the trash.')).toBeVisible()
    expect(
      screen.getByRole('heading', { level: 1, name: 'Release checklist' })
    ).toBeVisible()
  })

  it.each(['/wikis', '/embed/wikis'])(
    'leads from %s/<wiki>/pages/<page> to the pages above it, from the home page down',
    async base => {
      const { pagesApi, wiki, engineering, releases, checklist } = handbook()
      renderRoute(`${base}/${wiki.id}/pages/${checklist.id}`, { pagesApi })

      const path = await screen.findByRole('navigation', {
        name: 'Path to this page'
      })
      expect(linksIn(path)).toEqual([
        ['Handbook', `${base}/${wiki.id}`],
        ['Engineering', `${base}/${wiki.id}/pages/${engineering.id}`],
        ['Releases', `${base}/${wiki.id}/pages/${releases.id}`]
      ])
    }
  )

  it('names the home page of the personal wiki by its label', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ kind: 'personal' })
    const ideas = pagesApi.withPage(wiki.id, { title: 'Ideas' })
    renderRoute(`/wikis/${wiki.id}/pages/${ideas.id}`, { pagesApi })

    const path = await screen.findByRole('navigation', {
      name: 'Path to this page'
    })
    expect(linksIn(path)).toEqual([['Personal', `/wikis/${wiki.id}`]])
  })

  it.each(['/wikis', '/embed/wikis'])(
    'is not found at %s/<wiki>/pages/<page> once deleted for good',
    async base => {
      const { pagesApi, wiki, checklist } = handbook()
      await pagesApi.deletePage(checklist.id)
      await pagesApi.purgePage(wiki.id, checklist.id)
      renderRoute(`${base}/${wiki.id}/pages/${checklist.id}`, { pagesApi })

      expect(await findEmptyState(NOT_FOUND)).toBeInTheDocument()
      expect(
        screen.queryByRole('navigation', { name: 'Path to this page' })
      ).not.toBeInTheDocument()
    }
  )

  it('is not found below another wiki than its own', async () => {
    const { pagesApi, wiki } = handbook()
    const other = pagesApi.withWiki({ name: 'Board meetings' })
    const minutes = pagesApi.withPage(other.id, { title: 'Minutes' })
    renderRoute(`/wikis/${wiki.id}/pages/${minutes.id}`, { pagesApi })

    expect(await findEmptyState(NOT_FOUND)).toBeInTheDocument()
    expect(screen.queryByText('Minutes')).not.toBeInTheDocument()
  })

  it('shows placeholders while it loads', async () => {
    const { pagesApi, wiki, checklist } = handbook()
    pagesApi.getPage.mockReturnValue(new Promise(() => undefined))
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })
    await screen.findByRole('tree', { name: 'Pages' })

    expect(
      within(screen.getByRole('main')).getByRole('progressbar', {
        name: 'Loading'
      })
    ).toBeInTheDocument()
  })

  it('says so when it cannot be loaded', async () => {
    const { pagesApi, wiki, checklist } = handbook()
    pagesApi.getPage.mockRejectedValue(new ApiError(403, null))
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The page could not be loaded.'
    )
  })
})
