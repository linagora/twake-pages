import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/application/pages'
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

describe('the trash', () => {
  afterEach(() => {
    followZone(null)
    vi.useRealTimers()
  })

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
