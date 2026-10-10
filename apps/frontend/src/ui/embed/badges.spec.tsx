import type { Badge, TwakeSpaceConnection } from '@linagora/twake-embed'
import { act, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/application/pages'
import { fakePagesApi } from '@/testing/fakePagesApi'
import { toldAboutAVersion } from '@/testing/notifications'
import { renderWithProviders } from '@/testing/renderWithProviders'
import { useReportBadges } from '@/ui/embed/badges'

/** A TwakeSpace connection that keeps the badges it is told. */
function fakeSpace(): TwakeSpaceConnection & { reported: Badge[][] } {
  const reported: Badge[][] = []
  return {
    reported,
    location: () => null,
    hostOrigin: () => null,
    notifyLoginRequired: vi.fn(),
    reportOverlayRegion: vi.fn(),
    fillPage: vi.fn(),
    reportBadges: (badges: readonly Badge[]) => {
      reported.push([...badges])
    },
    syncHistory: () => () => undefined,
    disconnect: vi.fn()
  }
}

const BOB = 'bob@example.com'

/** Alice's two shared wikis, which Bob runs with her, each with a page. */
function twoWikis() {
  const pagesApi = fakePagesApi()
  const handbook = pagesApi.withWiki({
    name: 'Handbook',
    members: { [BOB]: 'editor' }
  })
  const guide = pagesApi.withWiki({
    name: 'Guide',
    members: { [BOB]: 'editor' }
  })
  const onboarding = pagesApi.withPage(handbook.id, { title: 'Onboarding' })
  const setup = pagesApi.withPage(guide.id, { title: 'Setup' })
  const bob = pagesApi.signedInAs(BOB)
  return { pagesApi, handbook, guide, onboarding, setup, bob }
}

describe('reporting badges to TwakeSpace', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reports a badge for each wiki with unread notifications, a wiki left out showing nothing', async () => {
    const { pagesApi, handbook, guide, onboarding, bob } = twoWikis()
    await toldAboutAVersion(bob, onboarding.id, 'New')
    const space = fakeSpace()
    renderWithProviders(<Reporter space={space} />, { pagesApi })

    await waitFor(() => {
      expect(space.reported).toContainEqual([
        { resourceId: handbook.id, count: 1 }
      ])
    })
    // The Guide has none: `/badges` leaves it out, and a missing wiki shows no badge
    expect(space.reported.flat()).not.toContainEqual(
      expect.objectContaining({ resourceId: guide.id })
    )
  })

  it('reads the badges again every minute, as Twake Tasks polls its count', async () => {
    const { pagesApi, handbook, onboarding, bob } = twoWikis()
    await toldAboutAVersion(bob, onboarding.id, 'New')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const space = fakeSpace()
    renderWithProviders(<Reporter space={space} />, { pagesApi })
    await waitFor(() => {
      expect(pagesApi.badges).toHaveBeenCalledTimes(1)
    })

    await act(() => vi.advanceTimersByTimeAsync(60_000))

    expect(pagesApi.badges).toHaveBeenCalledTimes(2)
    expect(space.reported.at(-1)).toEqual([
      { resourceId: handbook.id, count: 1 }
    ])
  })

  it('sends nothing when a poll fails after a success', async () => {
    const { pagesApi, handbook, onboarding, bob } = twoWikis()
    await toldAboutAVersion(bob, onboarding.id, 'New')
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const space = fakeSpace()
    renderWithProviders(<Reporter space={space} />, { pagesApi })
    await waitFor(() => {
      expect(space.reported).toContainEqual([
        { resourceId: handbook.id, count: 1 }
      ])
    })
    const reported = space.reported.length
    pagesApi.badges.mockImplementation(() =>
      Promise.reject(new ApiError(500, 'server_error'))
    )

    await act(() => vi.advanceTimersByTimeAsync(60_000))

    // A failed poll keeps the last data, which is not reported again
    expect(space.reported.length).toBe(reported)
  })
})

function Reporter({ space }: { space: TwakeSpaceConnection }): null {
  useReportBadges(space)
  return null
}
