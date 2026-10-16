import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Role } from '@/domain/wiki'
import { findEmptyState } from '@/testing/emptyState'
import { engineering } from '@/testing/engineering'
import { fakePagesApi, type FakePagesApi } from '@/testing/fakePagesApi'
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

/** The handbook, open on its home page for a person of `role`. */
async function renderTree(role?: Role) {
  const { pagesApi, wiki, engineering } = handbook(role)
  const { router } = renderRoute(`/wikis/${wiki.id}`, { pagesApi })
  const tree = await screen.findByRole('tree', { name: 'Pages' })
  return { pagesApi, tree, router, wiki, engineering }
}

// What the tree, in the wiki's navigation, says to screen readers, found by
// its words, as the navigation may hold other statuses.
const saying = (sentence: string) =>
  within(screen.getByRole('navigation', { name: 'Wiki' })).findByText(sentence)

// What the tree says went wrong, as the page beside it may say more.
const treeAlert = () =>
  within(screen.getByRole('navigation', { name: 'Wiki' })).findByRole('alert')

// Engineering, open on Laptop setup, with live updates down: the wiki shows
// as it was before what Bob does, until it is read again.
async function engineeringWithoutLiveUpdates() {
  const opened = engineering()
  opened.pagesApi.watchWiki.mockImplementation(() => () => undefined)
  await screen.findByRole('treeitem', { name: 'Laptop setup' })
  return opened
}

// Waits `ms`, else a turn of the event loop, by which a move started, by the
// keys or a drop, would have reached the API.
const settle = (ms = 0) =>
  act(
    () =>
      new Promise<void>(resolve => {
        setTimeout(resolve, ms)
      })
  )

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
  // Alt+Shift and an arrow, on the page that has the focus.
  const move = (arrow: string) => {
    press(arrow, { altKey: true, shiftKey: true })
  }

  it('goes down and up among its siblings, keeping the focus', async () => {
    const { tree } = await renderTree()
    focus('Onboarding')

    move('ArrowDown')

    expect(tree).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => {
      expect(titlesIn(tree)).toEqual(['Engineering', 'Onboarding'])
    })
    expect(item('Onboarding')).toHaveFocus()
    expect(
      await saying('Onboarding moved to the top of the tree, position 2 of 2.')
    ).toHaveAttribute('role', 'status')
    expect(tree).toHaveAttribute('aria-busy', 'false')

    move('ArrowUp')

    await waitFor(() => {
      expect(titlesIn(tree)).toEqual(['Onboarding', 'Engineering'])
    })
    expect(item('Onboarding')).toHaveFocus()
    expect(
      await saying('Onboarding moved to the top of the tree, position 1 of 2.')
    ).toHaveAttribute('role', 'status')
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
    expect(
      await saying('Engineering moved under Onboarding, position 3 of 3.')
    ).toHaveAttribute('role', 'status')
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
    expect(
      await saying('First day moved to the top of the tree, position 2 of 3.')
    ).toHaveAttribute('role', 'status')
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
    pagesApi.movePage.mockRejectedValueOnce(new ApiError(500, 'server_error'))
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

  it('says the tree changed meanwhile when a page beside its new place went to the trash, and shows it where it was', async () => {
    const { bob, releases } = await engineeringWithoutLiveUpdates()
    await bob.deletePage(releases.id)
    focus('Laptop setup')

    // Out to the top of the tree, between Onboarding and Releases.
    move('ArrowLeft')

    expect(await treeAlert()).toHaveTextContent(
      'The tree changed meanwhile: the page stays where it was.'
    )
    await waitFor(() => {
      expect(
        screen.queryByRole('treeitem', { name: 'Releases' })
      ).not.toBeInTheDocument()
    })
    expect(item('Laptop setup')).toHaveAttribute('aria-level', '2')
  })

  it('says the tree changed meanwhile when the page went to the trash', async () => {
    const { bob, laptop } = await engineeringWithoutLiveUpdates()
    await bob.deletePage(laptop.id)
    focus('Laptop setup')

    move('ArrowLeft')

    expect(await treeAlert()).toHaveTextContent(
      'The tree changed meanwhile: the page stays where it was.'
    )
  })

  it('says the tree changed meanwhile when the page was deleted for good', async () => {
    const { pagesApi, bob, wiki, laptop } =
      await engineeringWithoutLiveUpdates()
    await pagesApi.setMemberRole(wiki.id, bob.person.id, 'admin')
    await bob.deletePage(laptop.id)
    await bob.purgePage(wiki.id, laptop.id)
    focus('Laptop setup')

    move('ArrowLeft')

    expect(await treeAlert()).toHaveTextContent(
      'The tree changed meanwhile: the page stays where it was.'
    )
  })

  it('says the person can no longer move pages once made a viewer meanwhile', async () => {
    const { pagesApi, bob, wiki } = await engineeringWithoutLiveUpdates()
    await pagesApi.setMemberRole(wiki.id, bob.person.id, 'admin')
    await bob.setMemberRole(wiki.id, pagesApi.person.id, 'viewer')
    focus('Laptop setup')

    move('ArrowLeft')

    expect(await treeAlert()).toHaveTextContent(
      'You can no longer move pages in this wiki.'
    )
    expect(item('Laptop setup')).toHaveAttribute('aria-level', '2')
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

describe('a page dragged in the tree', () => {
  // jsdom lays nothing out: each row of the tree comes right under the one
  // before it, 32 pixels high and 240 wide, from the top of the page.
  const ROW = 32
  const rows = () =>
    [...document.querySelectorAll('[role="tree"] [role="treeitem"]')].map(
      each => each.parentElement
    )

  beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: Element) {
        const all = rows()
        if (this.matches('[role="tree"]')) {
          return new DOMRect(0, 0, 240, all.length * ROW)
        }
        const index = all.findIndex(row => row === this)
        return index < 0 ? new DOMRect() : new DOMRect(0, index * ROW, 240, ROW)
      }
    )
  })

  const topOf = (title: string) =>
    rows().indexOf(item(title).parentElement) * ROW

  // Presses the mouse on the row of `title`, then carries it past the six
  // pixels that pick the page up.
  const pickUp = (title: string) => {
    const y = topOf(title) + 8
    fireEvent.mouseDown(item(title), { button: 0, clientX: 20, clientY: y })
    fireEvent.mouseMove(document, { clientX: 20, clientY: y + 10 })
  }

  const carry = (y: number) => {
    fireEvent.mouseMove(document, { clientX: 20, clientY: y })
  }

  const letGo = () => {
    fireEvent.mouseUp(document)
  }

  // The API's answer to the next move, held back until called.
  const answerToNextMove = (pagesApi: FakePagesApi) => {
    const movePage = pagesApi.movePage.getMockImplementation()
    if (!movePage) throw new Error('The fake moves no page')
    let answer = (): void => undefined
    const answered = new Promise<void>(resolve => {
      answer = resolve
    })
    pagesApi.movePage.mockImplementationOnce(async (pageId, move) => {
      await answered
      return movePage(pageId, move)
    })
    return () => {
      act(() => {
        answer()
      })
    }
  }

  it('goes last to the top of the tree, dropped below the last row', async () => {
    const { tree } = await renderTree()

    pickUp('Onboarding')
    expect(await saying('Picked up Onboarding.')).toBeInTheDocument()
    carry(2 * ROW + ROW / 2)
    expect(
      await saying(
        'Onboarding would go to the top of the tree, position 2 of 2.'
      )
    ).toBeInTheDocument()
    letGo()

    await waitFor(() => {
      expect(titlesIn(tree)).toEqual(['Engineering', 'Onboarding'])
    })
    expect(
      await saying('Onboarding moved to the top of the tree, position 2 of 2.')
    ).toHaveAttribute('role', 'status')
  })

  it('goes last under the page dropped on the middle of its row, which expands', async () => {
    await renderTree()

    pickUp('Onboarding')
    carry(ROW + ROW / 2)
    expect(
      await saying('Onboarding would go under Engineering, position 2 of 2.')
    ).toBeInTheDocument()
    letGo()

    await waitFor(() => {
      expect(
        titlesIn(screen.getByRole('group', { name: 'Engineering' }))
      ).toEqual(['Releases', 'Onboarding'])
    })
    expect(item('Onboarding')).toHaveAttribute('aria-level', '2')
    expect(
      await saying('Onboarding moved under Engineering, position 2 of 2.')
    ).toHaveAttribute('role', 'status')
  })

  it('expands the page it is held over, then goes last under it', async () => {
    await renderTree()

    pickUp('Onboarding')
    carry(ROW + ROW / 2)
    expect(
      screen.queryByRole('group', { name: 'Engineering' })
    ).not.toBeInTheDocument()

    // About half a second later.
    const group = await screen.findByRole(
      'group',
      { name: 'Engineering' },
      { timeout: 2000 }
    )
    expect(titlesIn(group)).toEqual(['Releases'])
    letGo()

    await waitFor(() => {
      expect(
        titlesIn(screen.getByRole('group', { name: 'Engineering' }))
      ).toEqual(['Releases', 'Onboarding'])
    })
  })

  it('leaves collapsed a page it only passes over', async () => {
    await renderTree()

    pickUp('Onboarding')
    carry(ROW + ROW / 2)
    carry(2 * ROW + ROW / 2)
    // Past the half second that expands a page held over.
    await settle(700)

    expect(
      screen.queryByRole('group', { name: 'Engineering' })
    ).not.toBeInTheDocument()
    fireEvent.keyDown(document, { code: 'Escape' })
  })

  it('shows where it was dropped until the tree has it there', async () => {
    const { pagesApi, tree } = await renderTree()
    const answer = answerToNextMove(pagesApi)

    pickUp('Onboarding')
    carry(2 * ROW + ROW / 2)
    letGo()

    expect(titlesIn(tree)).toEqual(['Engineering', 'Onboarding'])
    expect(tree).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => {
      expect(pagesApi.movePage).toHaveBeenCalledTimes(1)
    })
    answer()

    await waitFor(() => {
      expect(tree).toHaveAttribute('aria-busy', 'false')
    })
    expect(titlesIn(tree)).toEqual(['Engineering', 'Onboarding'])
  })

  it('takes one move at a time, though the next drag focuses another row', async () => {
    const { pagesApi, tree } = await renderTree()
    const answer = answerToNextMove(pagesApi)
    pickUp('Onboarding')
    carry(2 * ROW + ROW / 2)
    letGo()
    await waitFor(() => {
      expect(pagesApi.movePage).toHaveBeenCalledTimes(1)
    })

    // As the press does in a browser, before the drag starts.
    focus('Engineering')
    pickUp('Engineering')
    // The middle of the row of Onboarding, were it back where it was.
    carry(ROW / 2)
    letGo()

    expect(await saying('Moving Engineering was canceled.')).toBeInTheDocument()
    await settle()
    expect(pagesApi.movePage).toHaveBeenCalledTimes(1)
    expect(titlesIn(tree)).toEqual(['Engineering', 'Onboarding'])
    answer()

    await waitFor(() => {
      expect(tree).toHaveAttribute('aria-busy', 'false')
    })
    expect(titlesIn(tree)).toEqual(['Engineering', 'Onboarding'])
  })

  it('shows a page whose drop was refused where it was, saying why', async () => {
    const { bob, releases } = await engineeringWithoutLiveUpdates()
    await bob.deletePage(releases.id)

    // Last at the top of the tree, after Releases.
    pickUp('Laptop setup')
    carry(4 * ROW + ROW / 2)
    letGo()

    expect(await treeAlert()).toHaveTextContent(
      'The tree changed meanwhile: the page stays where it was.'
    )
    await waitFor(() => {
      expect(
        screen.queryByRole('treeitem', { name: 'Releases' })
      ).not.toBeInTheDocument()
    })
    expect(item('Laptop setup')).toHaveAttribute('aria-level', '2')
  })

  it('moves nothing dropped where it is', async () => {
    const { pagesApi } = await renderTree()

    pickUp('Onboarding')
    // The top quarter of the next row: right after Onboarding.
    carry(ROW + 4)
    expect(
      await saying('Onboarding would stay where it is.')
    ).toBeInTheDocument()
    letGo()

    expect(await saying('Moving Onboarding was canceled.')).toBeInTheDocument()
    await settle()
    expect(pagesApi.movePage).not.toHaveBeenCalled()
  })

  it('moves nothing let go with Escape', async () => {
    const { pagesApi, tree } = await renderTree()

    pickUp('Onboarding')
    carry(2 * ROW + ROW / 2)
    fireEvent.keyDown(document, { code: 'Escape' })

    expect(await saying('Moving Onboarding was canceled.')).toBeInTheDocument()
    letGo()
    await settle()
    expect(pagesApi.movePage).not.toHaveBeenCalled()
    expect(titlesIn(tree)).toEqual(['Onboarding', 'Engineering'])
  })

  it('still opens the page clicked on its row', async () => {
    const { router, wiki, engineering } = await renderTree()
    const y = topOf('Engineering') + 8

    fireEvent.mouseDown(item('Engineering'), {
      button: 0,
      clientX: 20,
      clientY: y
    })
    // Short of the six pixels that pick the page up.
    fireEvent.mouseMove(document, { clientX: 23, clientY: y + 3 })
    fireEvent.mouseUp(item('Engineering'))
    fireEvent.click(item('Engineering'))

    expect(router.state.location.pathname).toBe(
      `/wikis/${wiki.id}/pages/${engineering.id}`
    )
  })

  it('stays put for a viewer of the wiki', async () => {
    const { pagesApi, tree } = await renderTree('viewer')

    pickUp('Onboarding')
    expect(screen.queryByText('Picked up Onboarding.')).not.toBeInTheDocument()
    carry(2 * ROW + ROW / 2)
    letGo()
    await settle()

    expect(pagesApi.movePage).not.toHaveBeenCalled()
    expect(titlesIn(tree)).toEqual(['Onboarding', 'Engineering'])
  })
})
