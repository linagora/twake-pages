import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { engineering } from '@/testing/engineering'
import { chooseIn } from '@/testing/forms'
import { pathToThePage } from '@/testing/pagePath'

/** Opens the dialog that moves the open page, once the tree shows. */
async function openMove(title: string): Promise<HTMLElement> {
  await screen.findByRole('tree', { name: 'Pages' })
  fireEvent.click(await screen.findByRole('button', { name: 'Page options' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move' }))
  return screen.getByRole('dialog', { name: `Move ${title}` })
}

const field = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole('combobox', { name })

const optionsOf = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map(option => option.textContent)

describe('a page moved from its menu', () => {
  it('goes to the top of the tree, after the pages there', async () => {
    const { pagesApi, laptop, releases } = engineering()
    const dialog = await openMove('Laptop setup')

    chooseIn(dialog, 'Parent', 'Top of the tree')
    expect(field(dialog, 'Place')).toHaveDisplayValue('Last')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))

    const status = await screen.findByText(
      'Laptop setup moved to the top of the tree, position 3 of 3.'
    )
    expect(status).toHaveAttribute('role', 'status')
    // Said once the dialog is gone: the screen it hid from screen readers
    // shows again.
    expect(status.closest('[aria-hidden="true"]')).toBeNull()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(pathToThePage()).toEqual(['Engineering'])
    const item = screen.getByRole('treeitem', { name: 'Laptop setup' })
    expect(item).toHaveAttribute('aria-level', '1')
    expect(item).toHaveAttribute('aria-posinset', '3')
    expect(pagesApi.movePage).toHaveBeenCalledWith(laptop.id, {
      parentId: null,
      afterId: releases.id
    })
  })

  it('goes under another page, at the place chosen among its child pages', async () => {
    const { pagesApi, laptop, releases, checklist } = engineering()
    const dialog = await openMove('Laptop setup')

    chooseIn(dialog, 'Parent', 'Releases')
    expect(optionsOf(field(dialog, 'Place'))).toEqual([
      'First',
      'After Checklist',
      'Last'
    ])
    chooseIn(dialog, 'Place', 'First')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))

    expect(
      await screen.findByText(
        'Laptop setup moved under Releases, position 1 of 2.'
      )
    ).toHaveAttribute('role', 'status')
    expect(pathToThePage()).toEqual(['Engineering', 'Releases'])
    const item = within(
      screen.getByRole('group', { name: 'Releases' })
    ).getByRole('treeitem', { name: 'Laptop setup' })
    expect(item).toHaveAttribute('aria-posinset', '1')
    expect(pagesApi.movePage).toHaveBeenCalledWith(laptop.id, {
      parentId: releases.id,
      beforeId: checklist.id
    })
  })

  it('may go under every page but itself and the pages under it', async () => {
    engineering('Onboarding')
    const dialog = await openMove('Onboarding')

    expect(optionsOf(field(dialog, 'Parent'))).toEqual([
      'Top of the tree',
      'Releases',
      'Releases / Checklist'
    ])
    expect(field(dialog, 'Parent')).toHaveDisplayValue('Top of the tree')
    expect(optionsOf(field(dialog, 'Place'))).toEqual([
      'First',
      'After Releases',
      'Last'
    ])
    expect(field(dialog, 'Place')).toHaveDisplayValue('First')
  })

  it('names the pages under others by their path', async () => {
    engineering()
    const dialog = await openMove('Laptop setup')

    expect(optionsOf(field(dialog, 'Parent'))).toEqual([
      'Top of the tree',
      'Onboarding',
      'Onboarding / First week',
      'Releases',
      'Releases / Checklist'
    ])
  })

  it('goes nowhere until another place is chosen', async () => {
    engineering()
    const dialog = await openMove('Laptop setup')
    const move = within(dialog).getByRole('button', { name: 'Move' })

    expect(field(dialog, 'Parent')).toHaveDisplayValue('Onboarding')
    expect(field(dialog, 'Place')).toHaveDisplayValue('First')
    expect(move).toBeDisabled()

    chooseIn(dialog, 'Place', 'After First week')

    expect(move).toBeEnabled()
  })

  it('says so when it cannot be moved', async () => {
    const { pagesApi } = engineering()
    pagesApi.movePage.mockRejectedValue(new ApiError(500, 'server_error'))
    const dialog = await openMove('Laptop setup')

    chooseIn(dialog, 'Parent', 'Top of the tree')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The page could not be moved.'
    )
  })

  it('says the person can no longer move pages when the wiki reloads without them, rather than close', async () => {
    const { pagesApi, bob, wiki } = engineering()
    // The move is what tells the person they lost the editor role: their own
    // wiki reloads without them, and the tree goes with the menu, but the
    // dialog must say why before, or instead of, closing. Bob, an admin here,
    // is who takes the role away.
    pagesApi.movePage.mockRejectedValue(new ApiError(403, 'forbidden'))
    const dialog = await openMove('Laptop setup')
    chooseIn(dialog, 'Parent', 'Top of the tree')

    await act(() => pagesApi.setMemberRole(wiki.id, bob.person.id, 'admin'))
    await act(() =>
      pagesApi.setMemberRole(wiki.id, pagesApi.person.id, 'viewer')
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You can no longer move pages in this wiki.'
    )
    expect(dialog).toBeInTheDocument()
  })

  it('stays put when the dialog is closed', async () => {
    const { pagesApi } = engineering()
    const dialog = await openMove('Laptop setup')

    chooseIn(dialog, 'Parent', 'Top of the tree')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(pagesApi.movePage).not.toHaveBeenCalled()
  })
})

describe('a page moved from its menu, while the tree changes elsewhere', () => {
  it('goes after the page chosen, though another now comes before that one', async () => {
    const { pagesApi, bob, wiki, laptop, releases, checklist } = engineering()
    const dialog = await openMove('Laptop setup')
    chooseIn(dialog, 'Parent', 'Releases')
    chooseIn(dialog, 'Place', 'After Checklist')

    await act(() =>
      bob.createPage(wiki.id, {
        title: 'Calendar',
        kind: 'document',
        parentId: releases.id,
        beforeId: checklist.id
      })
    )

    const place = field(dialog, 'Place')
    await within(place).findByRole('option', { name: 'After Calendar' })
    expect(place).toHaveDisplayValue('After Checklist')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    expect(
      await screen.findByText(
        'Laptop setup moved under Releases, position 3 of 3.'
      )
    ).toHaveAttribute('role', 'status')
    expect(pagesApi.movePage).toHaveBeenCalledWith(laptop.id, {
      parentId: releases.id,
      afterId: checklist.id
    })
  })

  it('goes last once the page chosen to go after is gone, never after another', async () => {
    const { pagesApi, bob, wiki, laptop, releases, checklist } = engineering()
    const dialog = await openMove('Laptop setup')
    chooseIn(dialog, 'Parent', 'Releases')
    const calendar = await act(() =>
      bob.createPage(wiki.id, {
        title: 'Calendar',
        kind: 'document',
        parentId: releases.id,
        afterId: checklist.id
      })
    )
    const roadmap = await act(() =>
      bob.createPage(wiki.id, {
        title: 'Roadmap',
        kind: 'document',
        parentId: releases.id,
        afterId: calendar.id
      })
    )
    const place = field(dialog, 'Place')
    await within(place).findByRole('option', { name: 'After Roadmap' })
    chooseIn(dialog, 'Place', 'After Checklist')

    await act(() => bob.deletePage(checklist.id))

    await waitFor(() => {
      expect(place).toHaveDisplayValue('Last')
    })
    expect(optionsOf(place)).toEqual([
      'First',
      'After Calendar',
      'After Roadmap',
      'Last'
    ])
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    expect(
      await screen.findByText(
        'Laptop setup moved under Releases, position 3 of 3.'
      )
    ).toHaveAttribute('role', 'status')
    expect(pagesApi.movePage).toHaveBeenCalledWith(laptop.id, {
      parentId: releases.id,
      afterId: roadmap.id
    })
  })

  it('goes to the top of the tree, as shown, once the parent chosen is gone', async () => {
    const { pagesApi, bob, onboarding, laptop, releases } = engineering()
    const dialog = await openMove('Laptop setup')
    chooseIn(dialog, 'Parent', 'Releases')

    await act(() => bob.deletePage(releases.id))

    await waitFor(() => {
      expect(optionsOf(field(dialog, 'Parent'))).not.toContain('Releases')
    })
    expect(field(dialog, 'Parent')).toHaveDisplayValue('Top of the tree')
    expect(field(dialog, 'Place')).toHaveDisplayValue('Last')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    expect(
      await screen.findByText(
        'Laptop setup moved to the top of the tree, position 2 of 2.'
      )
    ).toHaveAttribute('role', 'status')
    expect(pagesApi.movePage).toHaveBeenCalledWith(laptop.id, {
      parentId: null,
      afterId: onboarding.id
    })
  })

  it('says the tree changed meanwhile when its new parent went to the trash', async () => {
    const { pagesApi, bob, releases } = engineering()
    // Down, so the dialog still offers Releases once Bob deleted it.
    pagesApi.watchWiki.mockImplementation(() => () => undefined)
    const dialog = await openMove('Laptop setup')
    chooseIn(dialog, 'Parent', 'Releases')
    await bob.deletePage(releases.id)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The tree changed meanwhile: the page stays where it was.'
    )
    // In the tree behind the dialog, which stays open.
    expect(
      screen.getByRole('treeitem', { name: 'Laptop setup', hidden: true })
    ).toHaveAttribute('aria-level', '2')
  })
})
