import { act, fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute } from '@/testing/renderWithProviders'

/**
 * Onboarding, with First day and First week under it, then Engineering, with
 * Releases and its Release checklist.
 */
function handbook() {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({ name: 'Handbook' })
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

  it.each(['/wikis', '/embed/wikis'])(
    'leads from %s/<wiki> to each page',
    async base => {
      const { pagesApi, wiki, engineering } = handbook()
      renderRoute(`${base}/${wiki.id}`, { pagesApi })

      expect(
        await screen.findByRole('treeitem', { name: 'Engineering' })
      ).toHaveAttribute('href', `${base}/${wiki.id}/pages/${engineering.id}`)
    }
  )

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

  const focus = (name: string) => {
    act(() => {
      item(name).focus()
    })
  }

  const press = (key: string, modifiers: { ctrlKey?: boolean } = {}) => {
    if (!(document.activeElement instanceof HTMLElement)) {
      throw new Error('Nothing has the focus')
    }
    fireEvent.keyDown(document.activeElement, { key, ...modifiers })
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
