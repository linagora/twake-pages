import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Block } from '@/domain/page'
import { findEmptyState, PAGE_NOT_FOUND } from '@/testing/emptyState'
import {
  BUDGET,
  fakePagesApi,
  GRIST_ORIGIN,
  OFF_GRIST_ORIGINS
} from '@/testing/fakePagesApi'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'

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

/**
 * Opens the Release checklist, holding these blocks, where the pages frame
 * the documents of Grist on `gristOrigins`.
 */
function openChecklistOf(
  content: Block[],
  gristOrigins: readonly string[] = [GRIST_ORIGIN]
) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki()
  const checklist = pagesApi.withPage(wiki.id, {
    title: 'Release checklist',
    content
  })
  renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, {
    pagesApi,
    gristOrigins
  })
}

describe('a Grist embed of a page', () => {
  it('frames its document, with a link that opens it in Grist', async () => {
    openChecklistOf([{ type: 'gristEmbed', props: { url: BUDGET } }])

    expect(await screen.findByTitle('Grist document')).toHaveAttribute(
      'src',
      BUDGET
    )
    const open = screen.getByRole('link', { name: 'Open in Grist' })
    expect(open).toHaveAttribute('href', BUDGET)
    expect(open).toHaveAttribute('target', '_blank')
  })

  it.each(OFF_GRIST_ORIGINS)(
    'frames no document %s, and says so',
    async (_case, url) => {
      openChecklistOf([{ type: 'gristEmbed', props: { url } }])

      expect(
        await screen.findByText(
          'This Grist document is not shown, as Twake Pages shows Grist documents from https://grist.example.com only.'
        )
      ).toBeVisible()
      expect(screen.queryByTitle('Grist document')).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'Open in Grist' })
      ).not.toBeInTheDocument()
    }
  )

  it('frames no document where the pages frame no Grist, and says so', async () => {
    openChecklistOf([{ type: 'gristEmbed', props: { url: BUDGET } }], [])

    expect(
      await screen.findByText(
        'This Grist document is not shown, as Twake Pages shows no Grist documents.'
      )
    ).toBeVisible()
    expect(screen.queryByTitle('Grist document')).not.toBeInTheDocument()
  })

  it('shows nothing until it is given an address', async () => {
    openChecklistOf([
      { type: 'gristEmbed', props: { url: '' } },
      { type: 'paragraph', content: 'Then read the rules.' }
    ])

    expect(await screen.findByText('Then read the rules.')).toBeVisible()
    expect(screen.queryByTitle('Grist document')).not.toBeInTheDocument()
    expect(screen.queryByText(/Grist/)).not.toBeInTheDocument()
  })
})

describe('a database page', () => {
  /** Opens Budget, a database page at the Grist address `gristUrl`. */
  function openBudgetAt(gristUrl: string) {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    const budget = pagesApi.withPage(wiki.id, {
      title: 'Budget',
      kind: 'database',
      gristUrl
    })
    renderRoute(`/wikis/${wiki.id}/pages/${budget.id}`, { pagesApi })
  }

  it('frames its Grist document, with a link that opens it in Grist', async () => {
    openBudgetAt(BUDGET)

    expect(await screen.findByTitle('Grist document')).toHaveAttribute(
      'src',
      BUDGET
    )
    const open = screen.getByRole('link', { name: 'Open in Grist' })
    expect(open).toHaveAttribute('href', BUDGET)
    expect(open).toHaveAttribute('target', '_blank')
  })

  it('frames no document off the Grist origins, and says so', async () => {
    // Taken on an origin the deployment has dropped since.
    openBudgetAt('https://docs.example.com/o/docs/4kq2')

    expect(
      await screen.findByText(
        'This Grist document is not shown, as Twake Pages shows Grist documents from https://grist.example.com only.'
      )
    ).toBeVisible()
    expect(screen.queryByTitle('Grist document')).not.toBeInTheDocument()
  })
})

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

  it('shows the number of its version', async () => {
    const { pagesApi, wiki, checklist } = handbook()
    await pagesApi.publish(checklist.id, {
      baseVersion: 1,
      title: 'Release checklist',
      content: []
    })
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })

    expect(await screen.findByText('Version 2')).toBeVisible()
  })

  it.each(WIKI_BASES)(
    'leads from %s/<wiki>/pages/<page> to its history, by the number of its version',
    async base => {
      const { pagesApi, wiki, checklist } = handbook()
      renderRoute(`${base}/${wiki.id}/pages/${checklist.id}`, { pagesApi })

      expect(
        await screen.findByRole('link', { name: 'Version 1' })
      ).toHaveAttribute(
        'href',
        `${base}/${wiki.id}/pages/${checklist.id}/history`
      )
    }
  )

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
    // The field of a new comment, below the blocks, is the only one.
    expect(within(main).getAllByRole('textbox')).toEqual([
      within(main).getByRole('textbox', { name: 'Comment' })
    ])
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
    // The comments below take the level of the page's first headings.
    expect(
      within(main)
        .getAllByRole('heading', { level: 2 })
        .map(heading => heading.textContent)
    ).toEqual(['Before the release', 'Comments'])
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

  it('shows a block of a type it does not know as a card naming its kind, then the blocks under it', async () => {
    openChecklistOf([
      {
        type: 'callout',
        props: { tone: 'warning' },
        content: 'Mind the badge',
        children: [{ type: 'paragraph', content: 'Ask the release team.' }]
      }
    ])

    expect(
      await screen.findByRole('group', { name: 'callout block' })
    ).toBeVisible()
    expect(screen.getByText('Ask the release team.')).toBeVisible()
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

  it.each(WIKI_BASES)(
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

  it.each(WIKI_BASES)(
    'shows the home page at %s/<wiki>/pages/<home> on the home of its wiki',
    async base => {
      const { pagesApi, wiki } = handbook()
      await pagesApi.publish(wiki.homePageId, {
        baseVersion: 1,
        title: 'Welcome',
        content: []
      })
      const { router } = renderRoute(
        `${base}/${wiki.id}/pages/${wiki.homePageId}`,
        { pagesApi }
      )

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`${base}/${wiki.id}`)
      })
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Handbook' })
      ).toBeVisible()
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

  it.each(WIKI_BASES)(
    'is not found at %s/<wiki>/pages/<page> once deleted for good',
    async base => {
      const { pagesApi, wiki, checklist } = handbook()
      await pagesApi.deletePage(checklist.id)
      await pagesApi.purgePage(wiki.id, checklist.id)
      renderRoute(`${base}/${wiki.id}/pages/${checklist.id}`, { pagesApi })

      expect(await findEmptyState(PAGE_NOT_FOUND)).toBeInTheDocument()
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

    expect(await findEmptyState(PAGE_NOT_FOUND)).toBeInTheDocument()
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
  it.each(WIKI_BASES)(
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

describe('a page in the trash', () => {
  it('goes back to the tree once an editor restores it', async () => {
    const { pagesApi, wiki, releases } = handbook()
    await pagesApi.deletePage(releases.id)
    renderRoute(`/wikis/${wiki.id}/pages/${releases.id}`, { pagesApi })

    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(
        screen.queryByText('This page is in the trash.')
      ).not.toBeInTheDocument()
    })
    expect(
      within(screen.getByRole('group', { name: 'Engineering' })).getByRole(
        'treeitem',
        { name: 'Releases' }
      )
    ).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Edit page' })).toBeVisible()
    expect(pagesApi.restorePage).toHaveBeenCalledWith(releases.id)
  })

  it('is restored by editors only', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({
      role: 'viewer',
      members: { 'bob@example.com': 'editor' }
    })
    const checklist = pagesApi.withPage(wiki.id, { title: 'Checklist' })
    await pagesApi.signedInAs('bob@example.com').deletePage(checklist.id)
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })

    await screen.findByText('This page is in the trash.')
    // Named after the wiki once its role is known.
    await screen.findByRole('link', { name: 'Handbook' })
    expect(
      screen.queryByRole('button', { name: 'Restore' })
    ).not.toBeInTheDocument()
  })

  it.each(WIKI_BASES)(
    'leads at %s/<wiki> from a page deleted with its parent to that page, which restores both',
    async base => {
      const { pagesApi, wiki, engineering, checklist } = handbook()
      await pagesApi.deletePage(engineering.id)
      renderRoute(`${base}/${wiki.id}/pages/${checklist.id}`, { pagesApi })

      expect(
        await screen.findByText(
          'This page is in the trash, deleted with Engineering.'
        )
      ).toBeVisible()
      expect(
        screen.getByRole('link', { name: 'Open Engineering' })
      ).toHaveAttribute('href', `${base}/${wiki.id}/pages/${engineering.id}`)
      await screen.findByRole('link', { name: 'Handbook' })
      expect(
        screen.queryByRole('button', { name: 'Restore' })
      ).not.toBeInTheDocument()
    }
  )

  it('says so when it cannot be restored', async () => {
    const { pagesApi, wiki, releases } = handbook()
    await pagesApi.deletePage(releases.id)
    pagesApi.restorePage.mockRejectedValue(new ApiError(409, 'not_in_trash'))
    renderRoute(`/wikis/${wiki.id}/pages/${releases.id}`, { pagesApi })

    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }))

    expect(
      await screen.findByText('The page could not be restored.')
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The page could not be restored.'
    )
  })
})
