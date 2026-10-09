import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Role } from '@/domain/wiki'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'

/**
 * Onboarding, with First day and First week under it, then Engineering, with
 * Releases and its Release checklist.
 */
function handbook(role: Role = 'admin') {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Handbook', role })
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  pagesApi.withPage(wiki.id, { title: 'First day', parentId: onboarding.id })
  pagesApi.withPage(wiki.id, { title: 'First week', parentId: onboarding.id })
  const engineering = pagesApi.withPage(wiki.id, { title: 'Engineering' })
  const releases = pagesApi.withPage(wiki.id, {
    title: 'Releases',
    parentId: engineering.id
  })
  const checklist = pagesApi.withPage(wiki.id, {
    title: 'Release checklist',
    parentId: releases.id
  })
  return { pagesApi, wiki, engineering, checklist }
}

const titlesIn = (element: HTMLElement) =>
  within(element)
    .getAllByRole('treeitem')
    .map(item => item.textContent)

const item = (name: string) => screen.getByRole('treeitem', { name })

const focus = (name: string) => {
  act(() => {
    item(name).focus()
  })
}

/** Presses `key` on whatever has the focus. */
const press = (
  key: string,
  modifiers: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean } = {}
) => {
  if (!(document.activeElement instanceof HTMLElement)) {
    throw new Error('Nothing has the focus')
  }
  fireEvent.keyDown(document.activeElement, { key, ...modifiers })
}

// The chevron is for the mouse: the keyboard expands with the arrows.
function chevronOf(treeitem: HTMLElement): HTMLElement {
  const chevron = treeitem.previousElementSibling
  if (!(chevron instanceof HTMLElement)) throw new Error('No chevron')
  return chevron
}

describe('the tree of a wiki', () => {
  it('shows the pages beside the home page, in their order', async () => {
    const { pagesApi, wiki } = handbook()
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    const tree = await screen.findByRole('tree', { name: 'Pages' })
    expect(titlesIn(tree)).toEqual(['Onboarding', 'Engineering'])
  })

  it('shows the child pages under their parent, once expanded', async () => {
    const { pagesApi, wiki } = handbook()
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    await screen.findByRole('tree', { name: 'Pages' })
    expect(item('Onboarding')).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(chevronOf(item('Onboarding')))

    expect(item('Onboarding')).toHaveAttribute('aria-expanded', 'true')
    expect(titlesIn(screen.getByRole('group', { name: 'Onboarding' }))).toEqual(
      ['First day', 'First week']
    )

    fireEvent.click(chevronOf(item('Onboarding')))

    expect(item('Onboarding')).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('treeitem', { name: 'First day' })
    ).not.toBeInTheDocument()
  })

  // Named from its content, an item would take in the titles of the group it
  // owns, as the web platform tests have it, though jsdom leaves them out.
  it('has each page own the group of its child pages, named by its title alone', async () => {
    const { pagesApi, wiki } = handbook()
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    await screen.findByRole('tree', { name: 'Pages' })

    fireEvent.click(chevronOf(item('Onboarding')))

    const onboarding = item('Onboarding')
    const label = onboarding.getAttribute('aria-labelledby') ?? ''
    const group = screen.getByRole('group', { name: 'Onboarding' })
    expect({
      owns: onboarding.getAttribute('aria-owns'),
      label: document.getElementById(label)?.textContent
    }).toEqual({ owns: group.id, label: 'Onboarding' })
    expect(
      within(group)
        .getAllByRole('treeitem')
        .map(child => [
          child.getAttribute('aria-level'),
          child.getAttribute('aria-posinset'),
          child.getAttribute('aria-setsize')
        ])
    ).toEqual([
      ['2', '1', '2'],
      ['2', '2', '2']
    ])
  })

  it('expands the path to the open page', async () => {
    const { pagesApi, wiki, checklist } = handbook()
    renderRoute(`/wikis/${wiki.id}/pages/${checklist.id}`, { pagesApi })
    await screen.findByRole('tree', { name: 'Pages' })

    expect(item('Engineering')).toHaveAttribute('aria-expanded', 'true')
    expect(item('Releases')).toHaveAttribute('aria-expanded', 'true')
    expect(item('Release checklist')).toHaveAttribute('aria-current', 'page')
    expect(item('Onboarding')).toHaveAttribute('aria-expanded', 'false')
  })

  it('expands the path to a page opened from elsewhere', async () => {
    const { pagesApi, wiki, checklist } = handbook()
    const { router } = renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    await screen.findByRole('tree', { name: 'Pages' })

    await act(() => router.navigate(`/wikis/${wiki.id}/pages/${checklist.id}`))

    expect(item('Release checklist')).toHaveAttribute('aria-current', 'page')
  })

  it.each(WIKI_BASES)('leads from %s/<wiki> to each page', async base => {
    const { pagesApi, wiki, engineering } = handbook()
    renderRoute(`${base}/${wiki.id}`, { pagesApi })

    expect(
      await screen.findByRole('treeitem', { name: 'Engineering' })
    ).toHaveAttribute('href', `${base}/${wiki.id}/pages/${engineering.id}`)
  })

  it('says when the wiki has no pages but its home page', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    expect(await findEmptyState('No pages yet')).toBeInTheDocument()
  })

  it('says so when the pages cannot be loaded', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki()
    pagesApi.getTree.mockRejectedValue(new ApiError(403, null))
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The pages could not be loaded.'
    )
  })
})

describe('the tree of a wiki, from the keyboard', () => {
  async function renderTree() {
    const { pagesApi, wiki, engineering } = handbook()
    const { router } = renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    const tree = await screen.findByRole('tree', { name: 'Pages' })
    return { tree, router, wiki, engineering }
  }

  const tabIndexesIn = (tree: HTMLElement) =>
    within(tree)
      .getAllByRole('treeitem')
      .map(each => each.tabIndex)

  it('is one stop of the tab order', async () => {
    const { tree } = await renderTree()
    expect(tabIndexesIn(tree)).toEqual([0, -1])

    focus('Engineering')

    expect(tabIndexesIn(tree)).toEqual([-1, 0])
  })

  it('moves between the pages shown with the arrows, Home and End', async () => {
    await renderTree()
    focus('Onboarding')

    press('ArrowDown')
    expect(item('Engineering')).toHaveFocus()
    press('ArrowDown')
    expect(item('Engineering')).toHaveFocus()
    press('ArrowUp')
    expect(item('Onboarding')).toHaveFocus()
    press('End')
    expect(item('Engineering')).toHaveFocus()
    press('Home')
    expect(item('Onboarding')).toHaveFocus()
  })

  it('expands with the right arrow, then goes down to the first child page', async () => {
    await renderTree()
    focus('Engineering')

    press('ArrowRight')
    expect(item('Engineering')).toHaveAttribute('aria-expanded', 'true')
    expect(item('Engineering')).toHaveFocus()

    press('ArrowRight')
    expect(item('Releases')).toHaveFocus()
  })

  it('goes up to the parent with the left arrow, then collapses it', async () => {
    await renderTree()
    focus('Engineering')
    press('ArrowRight')
    press('ArrowRight')

    press('ArrowLeft')
    expect(item('Engineering')).toHaveFocus()
    expect(item('Engineering')).toHaveAttribute('aria-expanded', 'true')

    press('ArrowLeft')
    expect(item('Engineering')).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.queryByRole('treeitem', { name: 'Releases' })
    ).not.toBeInTheDocument()
  })

  it('opens the page with Enter', async () => {
    const { router, wiki, engineering } = await renderTree()
    focus('Engineering')

    press('Enter')

    expect(router.state.location.pathname).toBe(
      `/wikis/${wiki.id}/pages/${engineering.id}`
    )
  })

  it('leaves Enter with a modifier to the browser, to open the page elsewhere', async () => {
    const { router, wiki } = await renderTree()
    focus('Engineering')

    press('Enter', { ctrlKey: true })

    expect(router.state.location.pathname).toBe(`/wikis/${wiki.id}`)
  })
})

describe('a page moved from the keyboard, in the tree', () => {
  async function renderTree(role?: Role) {
    const { pagesApi, wiki } = handbook(role)
    renderRoute(`/wikis/${wiki.id}`, { pagesApi })
    const tree = await screen.findByRole('tree', { name: 'Pages' })
    return { pagesApi, tree }
  }

  // Alt+Shift and an arrow, on the page that has the focus.
  const move = (arrow: string) => {
    press(arrow, { altKey: true, shiftKey: true })
  }

  // What the tree, in the wiki's navigation, says to screen readers.
  const said = () =>
    within(screen.getByRole('navigation', { name: 'Wiki' })).getByRole('status')

  // Lets a move the keys would have started reach the API.
  const settle = () =>
    act(
      () =>
        new Promise<void>(resolve => {
          setTimeout(resolve, 0)
        })
    )

  it('goes down and up among its siblings, keeping the focus', async () => {
    const { tree } = await renderTree()
    focus('Onboarding')

    move('ArrowDown')

    expect(tree).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => {
      expect(titlesIn(tree)).toEqual(['Engineering', 'Onboarding'])
    })
    expect(item('Onboarding')).toHaveFocus()
    await waitFor(() => {
      expect(said()).toHaveTextContent(
        'Onboarding moved to the top of the tree, position 2 of 2.'
      )
    })
    expect(tree).toHaveAttribute('aria-busy', 'false')

    move('ArrowUp')

    await waitFor(() => {
      expect(titlesIn(tree)).toEqual(['Onboarding', 'Engineering'])
    })
    expect(item('Onboarding')).toHaveFocus()
    await waitFor(() => {
      expect(said()).toHaveTextContent(
        'Onboarding moved to the top of the tree, position 1 of 2.'
      )
    })
  })

  it('goes under the page before it at its level, which opens, keeping the focus', async () => {
    await renderTree()
    focus('Engineering')

    move('ArrowRight')

    await waitFor(() => {
      expect(
        titlesIn(screen.getByRole('group', { name: 'Onboarding' }))
      ).toEqual(['First day', 'First week', 'Engineering'])
    })
    expect(item('Engineering')).toHaveAttribute('aria-level', '2')
    expect(item('Engineering')).toHaveFocus()
    await waitFor(() => {
      expect(said()).toHaveTextContent(
        'Engineering moved under Onboarding, position 3 of 3.'
      )
    })
  })

  it('goes under the page before it at its level, not under the child page shown above it', async () => {
    await renderTree()
    focus('Onboarding')
    press('ArrowRight')
    expect(item('First week')).toBeInTheDocument()
    focus('Engineering')

    move('ArrowRight')

    await waitFor(() => {
      expect(
        titlesIn(screen.getByRole('group', { name: 'Onboarding' }))
      ).toEqual(['First day', 'First week', 'Engineering'])
    })
    expect(item('Engineering')).toHaveAttribute('aria-level', '2')
  })

  it('goes out to its parent’s level, right after its parent, keeping the focus', async () => {
    const { tree } = await renderTree()
    focus('Onboarding')
    press('ArrowRight')
    press('ArrowRight')
    expect(item('First day')).toHaveFocus()

    move('ArrowLeft')

    await waitFor(() => {
      expect(titlesIn(tree)).toEqual([
        'Onboarding',
        'First week',
        'First day',
        'Engineering'
      ])
    })
    expect(item('First day')).toHaveAttribute('aria-level', '1')
    expect(item('First day')).toHaveFocus()
    await waitFor(() => {
      expect(said()).toHaveTextContent(
        'First day moved to the top of the tree, position 2 of 3.'
      )
    })
  })

  it('stays put where it can go no further', async () => {
    const { pagesApi } = await renderTree()

    focus('Onboarding')
    // The first of its siblings, with no page above it, at the top of the tree.
    move('ArrowUp')
    move('ArrowRight')
    move('ArrowLeft')
    focus('Engineering')
    // The last of its siblings.
    move('ArrowDown')
    await settle()

    expect(pagesApi.movePage).not.toHaveBeenCalled()
  })

  it('takes one move at a time', async () => {
    const { pagesApi, tree } = await renderTree()
    focus('Onboarding')

    move('ArrowDown')
    move('ArrowDown')

    await waitFor(() => {
      expect(titlesIn(tree)).toEqual(['Engineering', 'Onboarding'])
    })
    expect(pagesApi.movePage).toHaveBeenCalledTimes(1)
  })

  it('says so when it cannot be moved, then takes the next move', async () => {
    const { pagesApi, tree } = await renderTree()
    pagesApi.movePage.mockRejectedValueOnce(
      new ApiError(409, 'stale_neighbours')
    )
    focus('Onboarding')

    move('ArrowDown')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The page could not be moved.'
    )
    await waitFor(() => {
      expect(tree).toHaveAttribute('aria-busy', 'false')
    })
    expect(titlesIn(tree)).toEqual(['Onboarding', 'Engineering'])

    move('ArrowDown')

    await waitFor(() => {
      expect(titlesIn(tree)).toEqual(['Engineering', 'Onboarding'])
    })
  })

  it('takes the next move when the tree cannot be read again after one', async () => {
    const { pagesApi, tree } = await renderTree()
    pagesApi.getTree.mockRejectedValue(new ApiError(403, null))
    focus('Onboarding')

    move('ArrowDown')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The pages could not be loaded.'
    )
    await waitFor(() => {
      expect(tree).toHaveAttribute('aria-busy', 'false')
    })

    move('ArrowDown')

    await waitFor(() => {
      expect(pagesApi.movePage).toHaveBeenCalledTimes(2)
    })
  })

  it('stays put for a viewer of the wiki', async () => {
    const { pagesApi } = await renderTree('viewer')
    await screen.findByRole('heading', { level: 1, name: 'Handbook' })
    focus('Onboarding')

    move('ArrowDown')
    await settle()

    expect(pagesApi.movePage).not.toHaveBeenCalled()
  })
})
