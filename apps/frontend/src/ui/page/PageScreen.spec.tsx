import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Block } from '@/domain/page'
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

/** Opens the Release checklist, holding these blocks. */
function openChecklistOf(content: Block[]) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki()
  const checklist = pagesApi.withPage(wiki.id, {
    title: 'Release checklist',
    content
  })
  renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })
}

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
    openChecklistOf([
      { type: 'heading', content: 'Before the release' },
      { type: 'paragraph', content: 'Freeze the branch on Thursdays.' }
    ])

    expect(
      await screen.findByText('Freeze the branch on Thursdays.')
    ).toBeVisible()
    const main = screen.getByRole('main')
    expect(
      within(main).getByRole('heading', { name: 'Before the release' })
    ).toBeVisible()
    expect(within(main).queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('shows the headings of its blocks below its title', async () => {
    openChecklistOf([
      { type: 'heading', props: { level: 1 }, content: 'Before the release' },
      { type: 'heading', props: { level: 2 }, content: 'On Thursday' }
    ])
    await screen.findByText('On Thursday')

    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { level: 1 })).toHaveTextContent(
      'Release checklist'
    )
    expect(within(main).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Before the release'
    )
    expect(within(main).getByRole('heading', { level: 3 })).toHaveTextContent(
      'On Thursday'
    )
  })

  it('shows the two deepest headings of its blocks at the last level', async () => {
    openChecklistOf([
      { type: 'heading', props: { level: 5 }, content: 'Before the release' },
      { type: 'heading', props: { level: 6 }, content: 'On Thursday' }
    ])
    await screen.findByText('On Thursday')

    expect(
      screen
        .getAllByRole('heading', { level: 6 })
        .map(heading => heading.textContent)
    ).toEqual(['Before the release', 'On Thursday'])
  })

  it('shows the list items of its blocks in a list', async () => {
    openChecklistOf([
      { type: 'bulletListItem', content: 'Freeze the branch' },
      { type: 'bulletListItem', content: 'Tag the release' }
    ])
    await screen.findByText('Freeze the branch')

    expect(
      screen.getAllByRole('list').map(list =>
        within(list)
          .queryAllByRole('listitem')
          .map(item => item.textContent)
      )
    ).toContainEqual(['Freeze the branch', 'Tag the release'])
  })

  it('shows the check list items of its blocks ticked or not, read only', async () => {
    openChecklistOf([
      {
        type: 'checkListItem',
        props: { checked: true },
        content: 'Freeze the branch'
      }
    ])

    const box = await screen.findByRole('checkbox')
    expect(box).toBeChecked()
    expect(box).toBeDisabled()
  })

  it('keeps the links of its blocks from running scripts', async () => {
    openChecklistOf([
      {
        type: 'file',
        props: { name: 'Release notes', url: 'javascript:alert(1)' }
      }
    ])

    expect(await screen.findByText('Release notes')).not.toHaveAttribute('href')
  })

  it('opens the links of its blocks in a new tab', async () => {
    openChecklistOf([
      {
        type: 'paragraph',
        content: [
          {
            type: 'link',
            href: 'https://example.com/notes',
            content: 'Release notes'
          }
        ]
      }
    ])

    expect(
      await screen.findByRole('link', { name: 'Release notes' })
    ).toHaveAttribute('target', '_blank')
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

describe('the Edit action of a page', () => {
  it.each(['/wikis', '/embed/wikis'])(
    'leads an editor of the wiki at %s/<wiki>/pages/<page> to the editor',
    async base => {
      const pagesApi = fakePagesApi()
      const wiki = pagesApi.withWiki({ role: 'editor' })
      const checklist = pagesApi.withPage(wiki.id, { title: 'Checklist' })
      renderRoute(`${base}/${wiki.id}/pages/${checklist.id}`, { pagesApi })

      expect(
        await screen.findByRole('link', { name: 'Edit page' })
      ).toHaveAttribute('href', `${base}/${wiki.id}/pages/${checklist.id}/edit`)
    }
  )

  it('is not offered to a viewer of the wiki', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ role: 'viewer' })
    const checklist = pagesApi.withPage(wiki.id, { title: 'Checklist' })
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })

    // Named after the wiki once its role is known.
    await screen.findByRole('link', { name: 'Handbook' })
    expect(
      screen.queryByRole('link', { name: 'Edit page' })
    ).not.toBeInTheDocument()
  })

  it('is not offered for a page in the trash', async () => {
    const { pagesApi, wiki, checklist } = handbook()
    await pagesApi.deletePage(checklist.id)
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })

    await screen.findByText('This page is in the trash.')
    await screen.findByRole('link', { name: 'Handbook' })
    expect(
      screen.queryByRole('link', { name: 'Edit page' })
    ).not.toBeInTheDocument()
  })

  it('is not offered for a database, which shows a Grist document', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    const budget = pagesApi.withPage(wiki.id, {
      title: 'Budget',
      kind: 'database'
    })
    renderRoute(`/wikis/${wiki.id}/pages/${budget.id}`, { pagesApi })

    await screen.findByRole('heading', { level: 1, name: 'Budget' })
    await screen.findByRole('link', { name: 'Handbook' })
    expect(
      screen.queryByRole('link', { name: 'Edit page' })
    ).not.toBeInTheDocument()
  })
})
