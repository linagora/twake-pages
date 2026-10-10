import { embedRoute, type TwakeSpaceConnection } from '@linagora/twake-embed'
import { useEffect, type ReactElement } from 'react'
import { Outlet, useNavigate } from 'react-router'

import { useReportBadges } from '@/ui/embed/badges'
import { EMBED_PREFIX, getTwakeSpace } from '@/ui/embed/twakeSpace'

// Tells TwakeSpace the badges of its tabs while the frame shows a wiki.
function SpaceReporter({ space }: { space: TwakeSpaceConnection }): null {
  useReportBadges(space)
  return null
}

export function EmbedLayout(): ReactElement {
  const navigate = useNavigate()
  const space = getTwakeSpace()

  useEffect(() => {
    const show = (resourceId: string, path: string): Promise<void> =>
      Promise.resolve(
        navigate(embedRoute(EMBED_PREFIX, resourceId) + path, { replace: true })
      )
    return getTwakeSpace()?.syncHistory({ onLoad: show, onNavigate: show })
  }, [navigate])

  return (
    <>
      {space && <SpaceReporter space={space} />}
      <Outlet />
    </>
  )
}
