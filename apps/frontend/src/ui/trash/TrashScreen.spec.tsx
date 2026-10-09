import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/application/pages'
import type { Role } from '@/domain/wiki'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { renderRoute, WIKI_BASES } from '@/testing/renderWithProviders'
import { followZone } from '@/ui/settings/zone'

const BOB = 'bob@example.com'
const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE

/**
 * Engineering, in Tokyo, from which Alice deleted Onboarding, with its child
 * page Laptop setup, then Bob deleted Releases, at 6:30 PM on Mar 2, 2100.
 */
async function engineeringTrash() {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({
    name: 'Engineering',
    members: { [BOB]: 'editor' }
  })
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  pagesApi.withPage(wiki.id, {
    title: 'Laptop setup',
    parentId: onboarding.id
  })
  const releases = pagesApi.withPage(wiki.id, { title: 'Releases' })
  followZone('Asia/Tokyo')
  // Later than any time the fake gave before, as its times only move on: a
  // millisecond apart, the pages are deleted in the same minute.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2100-03-02T09:30:00Z'))
  await pagesApi.deletePage(onboarding.id)
  await pagesApi.signedInAs(BOB, 'Bob Durand').deletePage(releases.id)
  vi.useRealTimers()
  return { pagesApi, wiki, onboarding, releases }
}

/**
 * The trash of Engineering, open to a person of that `role`, once Bob, who
 * runs the wiki, deleted Onboarding.
 */
async function trashListFor(role: Role) {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({
    name: 'Engineering',
    role,
    members: { [BOB]: 'admin' }
  })
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  await pagesApi.signedInAs(BOB).deletePage(onboarding.id)
  renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })
  return within(await screen.findByRole('list', { name: 'Trash' }))
}

/** Opens the dialog that deletes the page for good, from its line. */
async function openPurge(title: string): Promise<HTMLElement> {
  const trash = within(await screen.findByRole('list', { name: 'Trash' }))
  fireEvent.click(
    trash.getByRole('button', { name: `Delete for good ${title}` })
  )
  return screen.getByRole('dialog', { name: `Delete ${title} for good?` })
}

/** Opens the dialog that empties the trash, from above its list. */
async function openEmptyTrash(): Promise<HTMLElement> {
  await screen.findByRole('list', { name: 'Trash' })
  fireEvent.click(screen.getByRole('button', { name: 'Empty the trash' }))
  return screen.getByRole('dialog', { name: 'Empty the trash?' })
}

afterEach(() => {
  followZone(null)
  vi.useRealTimers()
})

describe('the trash', () => {
  it.each(WIKI_BASES)(
    'lists at %s/<wiki>/trash the deleted pages newest first, each leading to its page',
    async base => {
      const { pagesApi, wiki, onboarding, releases } = await engineeringTrash()
      renderRoute(`${base}/${wiki.id}/trash`, { pagesApi })

      const trash = within(await screen.findByRole('list', { name: 'Trash' }))
      expect(
        trash
          .getAllByRole('link')
          .map(link => [link.textContent, link.getAttribute('href')])
      ).toEqual([
        ['Releases', `${base}/${wiki.id}/pages/${releases.id}`],
        ['Onboarding', `${base}/${wiki.id}/pages/${onboarding.id}`]
      ])
    }
  )

  it('tells who deleted each page, when, and how many pages went with it', async () => {
    const { pagesApi, wiki } = await engineeringTrash()
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })

    const trash = within(await screen.findByRole('list', { name: 'Trash' }))
    const onboarding = trash.getByRole('listitem', { name: 'Onboarding' })
    expect(onboarding).toHaveTextContent('Onboarding · 1 page inside')
    expect(onboarding).toHaveTextContent(
      'Deleted by Alice Martin on Mar 2, 2100, 6:30 PM'
    )
    const releases = trash.getByRole('listitem', { name: 'Releases' })
    expect(releases).toHaveTextContent(
      'Deleted by Bob Durand on Mar 2, 2100, 6:30 PM'
    )
    expect(releases).not.toHaveTextContent('inside')
    expect(
      screen.getByText('Pages in the trash are deleted for good after 30 days.')
    ).toBeVisible()
  })

  it.each([
    ['a minute', '30 days left', MINUTE],
    ['27 days', '3 days left', 27 * DAY + MINUTE],
    // Due, while the purge has yet to run.
    ['31 days', '1 day left', 31 * DAY]
  ])(
    'tells, %s after the pages went to it, that each has %s',
    async (_after, left, elapsed) => {
      const { pagesApi, wiki } = await engineeringTrash()
      // The fake's times only move on: after a test that showed the trash
      // later, the pages went later than the fixture says.
      const deletedAt = Math.min(
        ...(await pagesApi.listTrash(wiki.id)).map(entry =>
          Date.parse(entry.deletedAt)
        )
      )
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(deletedAt + elapsed)
      renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })

      const trash = within(await screen.findByRole('list', { name: 'Trash' }))
      expect(
        trash.getByRole('listitem', { name: 'Onboarding' })
      ).toHaveTextContent(left)
      expect(
        trash.getByRole('listitem', { name: 'Releases' })
      ).toHaveTextContent(left)
    }
  )

  it('says when it is empty, and how long deleted pages stay in it', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    pagesApi.withPage(wiki.id, { title: 'Onboarding' })
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })

    expect(await findEmptyState('The trash is empty')).toHaveTextContent(
      'Pages in the trash are deleted for good after 30 days.'
    )
    expect(
      screen.queryByRole('list', { name: 'Trash' })
    ).not.toBeInTheDocument()
  })

  it('says so when it cannot be loaded, and never looks empty', async () => {
    const { pagesApi, wiki } = await engineeringTrash()
    pagesApi.listTrash.mockRejectedValue(new ApiError(403, null))
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The trash could not be loaded.'
    )
    expect(screen.queryByText('The trash is empty')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('list', { name: 'Trash' })
    ).not.toBeInTheDocument()
  })
})

describe('a page restored from the trash', () => {
  it('goes back to the tree with the pages inside, once an editor restores it', async () => {
    const { pagesApi, wiki, onboarding } = await engineeringTrash()
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })

    const trash = within(await screen.findByRole('list', { name: 'Trash' }))
    fireEvent.click(trash.getByRole('button', { name: 'Restore Onboarding' }))

    expect(
      await screen.findByText('Onboarding is back in the tree.')
    ).toBeVisible()
    expect(
      trash.queryByRole('listitem', { name: 'Onboarding' })
    ).not.toBeInTheDocument()
    const tree = within(screen.getByRole('tree', { name: 'Pages' }))
    fireEvent.keyDown(tree.getByRole('treeitem', { name: 'Onboarding' }), {
      key: 'ArrowRight'
    })
    expect(
      within(tree.getByRole('group', { name: 'Onboarding' })).getByRole(
        'treeitem',
        { name: 'Laptop setup' }
      )
    ).toBeVisible()
    expect(pagesApi.restorePage).toHaveBeenCalledWith(onboarding.id)
  })

  it('is offered to editors only', async () => {
    const trash = await trashListFor('viewer')

    expect(trash.getByRole('listitem', { name: 'Onboarding' })).toBeVisible()
    expect(
      trash.queryByRole('button', { name: 'Restore Onboarding' })
    ).not.toBeInTheDocument()
  })

  it('says so when it cannot be restored, and stays in the trash', async () => {
    const { pagesApi, wiki } = await engineeringTrash()
    pagesApi.restorePage.mockRejectedValue(new ApiError(500, null))
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })

    const trash = within(await screen.findByRole('list', { name: 'Trash' }))
    fireEvent.click(trash.getByRole('button', { name: 'Restore Onboarding' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Onboarding could not be restored.'
    )
    expect(trash.getByRole('listitem', { name: 'Onboarding' })).toBeVisible()
  })
})

describe('a page deleted for good', () => {
  it('leaves the trash once an admin is sure', async () => {
    const { pagesApi, wiki, onboarding } = await engineeringTrash()
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })
    const dialog = await openPurge('Onboarding')
    expect(dialog).toHaveTextContent(
      'Any pages inside go with it, for every member. This cannot be undone.'
    )

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete for good' })
    )

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    const trash = within(screen.getByRole('list', { name: 'Trash' }))
    expect(
      trash.queryByRole('listitem', { name: 'Onboarding' })
    ).not.toBeInTheDocument()
    expect(trash.getByRole('listitem', { name: 'Releases' })).toBeVisible()
    expect(pagesApi.purgePage).toHaveBeenCalledWith(wiki.id, onboarding.id)
  })

  it('stays in the trash when not sure', async () => {
    const { pagesApi, wiki } = await engineeringTrash()
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })
    const dialog = await openPurge('Onboarding')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(screen.getByRole('listitem', { name: 'Onboarding' })).toBeVisible()
    expect(pagesApi.purgePage).not.toHaveBeenCalled()
  })

  it('is offered to admins only', async () => {
    const trash = await trashListFor('editor')

    expect(
      trash.getByRole('button', { name: 'Restore Onboarding' })
    ).toBeVisible()
    expect(
      trash.queryByRole('button', { name: 'Delete for good Onboarding' })
    ).not.toBeInTheDocument()
  })

  it('says so when it cannot be deleted for good', async () => {
    const { pagesApi, wiki } = await engineeringTrash()
    pagesApi.purgePage.mockRejectedValue(new ApiError(409, 'not_in_trash'))
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })
    const dialog = await openPurge('Onboarding')

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Delete for good' })
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The page could not be deleted for good.'
    )
  })
})

describe('the trash emptied', () => {
  it('holds no page once an admin is sure', async () => {
    const { pagesApi, wiki } = await engineeringTrash()
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })
    const dialog = await openEmptyTrash()
    expect(dialog).toHaveTextContent(
      'Every page in it is deleted for good, for every member. This cannot be undone.'
    )

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Empty the trash' })
    )

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(await findEmptyState('The trash is empty')).toBeVisible()
    expect(pagesApi.emptyTrash).toHaveBeenCalledWith(wiki.id)
  })

  it('keeps its pages when not sure', async () => {
    const { pagesApi, wiki } = await engineeringTrash()
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })
    const dialog = await openEmptyTrash()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(dialog).not.toBeInTheDocument()
    })
    expect(
      within(screen.getByRole('list', { name: 'Trash' })).getAllByRole(
        'listitem'
      )
    ).toHaveLength(2)
    expect(pagesApi.emptyTrash).not.toHaveBeenCalled()
  })

  it('is offered to admins only', async () => {
    await trashListFor('editor')

    expect(
      screen.queryByRole('button', { name: 'Empty the trash' })
    ).not.toBeInTheDocument()
  })

  it('is offered with pages in the trash only', async () => {
    const pagesApi = fakePagesApi()
    const wiki = pagesApi.withWiki({ name: 'Engineering' })
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })

    expect(await findEmptyState('The trash is empty')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Empty the trash' })
    ).not.toBeInTheDocument()
  })

  it('says so when it cannot be emptied', async () => {
    const { pagesApi, wiki } = await engineeringTrash()
    pagesApi.emptyTrash.mockRejectedValue(new ApiError(500, null))
    renderRoute(`/wikis/${wiki.id}/trash`, { pagesApi })
    const dialog = await openEmptyTrash()

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Empty the trash' })
    )

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'The trash could not be emptied.'
    )
  })
})
