import { embedRoute } from '@linagora/twake-embed'
import { useEffect, type ReactElement } from 'react'
import { Outlet, useNavigate } from 'react-router'

import { EMBED_PREFIX, getTwakeSpace } from '@/ui/embed/twakeSpace'

export function EmbedLayout(): ReactElement {
  const navigate = useNavigate()

  useEffect(() => {
    const show = (resourceId: string, path: string): Promise<void> =>
      Promise.resolve(
        navigate(embedRoute(EMBED_PREFIX, resourceId) + path, { replace: true })
      )
    return getTwakeSpace()?.syncHistory({ onLoad: show, onNavigate: show })
  }, [navigate])

  return <Outlet />
}
