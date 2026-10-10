import type { Badge, TwakeSpaceConnection } from '@linagora/twake-embed'
import { useEffect, useRef } from 'react'

import { useBadges } from '@/ui/wiki/queries'

// What TwakeSpace accepts in one snapshot
const MAX_BADGES = 1000
const MAX_COUNT = 1_000_000

/**
 * Tells TwakeSpace the badges of its tabs: the unread notifications of every
 * wiki of the person, whichever one the frame shows. `/badges` answers only
 * the wikis that have unread ones, where Twake Tasks sends a 0 for each
 * project: a wiki left out shows no badge, as a count of 0 does, so the
 * missing ones need no entry. Nothing is sent while they load or when they
 * cannot be loaded, and a snapshot is sent again only when it changes.
 */
export function useReportBadges(space: TwakeSpaceConnection): void {
  const badges = useBadges()
  const sent = useRef<string | null>(null)

  // An error keeps the last data: it is not reported again
  const list = badges.isSuccess ? badges.data : null

  useEffect(() => {
    if (!list) return
    const reported: Badge[] = list
      .slice(0, MAX_BADGES)
      .map(({ wikiId, count }) => ({
        resourceId: wikiId,
        count: Math.min(Math.max(Math.trunc(count), 0), MAX_COUNT)
      }))
    const snapshot = JSON.stringify(reported)
    if (snapshot === sent.current) return
    sent.current = snapshot
    space.reportBadges(reported)
  }, [space, list])
}
