import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ApiError } from '@/application/pages'
import { findEmptyState } from '@/testing/emptyState'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { toldAboutAVersion } from '@/testing/notifications'
import { renderRoute } from '@/testing/renderWithProviders'

const BOB = 'bob@example.com'

/** Alice's Handbook, which Bob runs with her, and its Onboarding page. */
function sharedHandbook() {
  const pagesApi = fakePagesApi()
  const wiki = pagesApi.withWiki({
    name: 'Handbook',
    members: { [BOB]: 'editor' }
  })
  const onboarding = pagesApi.withPage(wiki.id, { title: 'Onboarding' })
  const bob = pagesApi.signedInAs(BOB, 'Bob Stone')
  return { pagesApi, bob, wiki, onboarding }
}

describe('NotificationsScreen', () => {
  it('lists a notification by its reason, page, actor and time', async () => {
    const { pagesApi, bob, onboarding } = sharedHandbook()
    await toldAboutAVersion(bob, onboarding.id, 'Onboarding')
    renderRoute('/notifications', { pagesApi })

    const list = within(
      await screen.findByRole('list', { name: 'Notifications' })
    )
    expect(list.getAllByRole('listitem')).toHaveLength(1)
    expect(list.getByRole('link', { name: 'Onboarding' })).toBeInTheDocument()
    expect(list.getByText(/Bob Stone published a new version/)).toBeVisible()
  })

  it('says there are none, with a hint', async () => {
    const { pagesApi } = sharedHandbook()
    renderRoute('/notifications', { pagesApi })

    expect(await findEmptyState('No notifications')).toBeVisible()
  })

  it('says so when they fail to load, never looking empty', async () => {
    const pagesApi = fakePagesApi()
    pagesApi.listNotifications.mockRejectedValue(new ApiError(403, null))
    renderRoute('/notifications', { pagesApi })

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The notifications could not be loaded.'
    )
  })

  it('marks a notification read as its page opens', async () => {
    const { pagesApi, bob, wiki, onboarding } = sharedHandbook()
    await toldAboutAVersion(bob, onboarding.id, 'Onboarding')
    const { router } = renderRoute('/notifications', { pagesApi })

    fireEvent.click(await screen.findByRole('link', { name: 'Onboarding' }))

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        `/wikis/${wiki.id}/pages/${onboarding.id}`
      )
    })
    await waitFor(async () => {
      await expect(pagesApi.listNotifications()).resolves.toMatchObject({
        unread: 0
      })
    })
  })

  it('marks them all read from the button, the count in the bar going', async () => {
    const { pagesApi, bob, onboarding } = sharedHandbook()
    await toldAboutAVersion(bob, onboarding.id, 'Onboarding')
    renderRoute('/notifications', { pagesApi })

    const nav = within(await screen.findByRole('navigation'))
    await nav.findByRole('link', { name: 'Notifications, 1 unread' })

    fireEvent.click(screen.getByRole('button', { name: 'Mark all as read' }))

    await waitFor(async () => {
      await expect(pagesApi.listNotifications()).resolves.toMatchObject({
        unread: 0
      })
    })
    await waitFor(() => {
      expect(
        nav.queryByRole('link', { name: 'Notifications, 1 unread' })
      ).toBeNull()
    })
  })
})
