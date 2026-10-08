import { embedRoute } from '@linagora/twake-embed'
import { Library } from '@linagora/twake-icons'
import { useEffect, type ReactElement } from 'react'
import { Outlet, useNavigate } from 'react-router'

import { EmptyState } from '@/ds/EmptyState'
import { useI18n } from '@/ui/i18n/useI18n'

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

// Stands for the wiki until its pages are built.
export function EmbedWikiScreen(): ReactElement {
  const { t } = useI18n()
  return (
    <main className="u-p-2">
      <EmptyState
        icon={Library}
        title={t('wiki.placeholder')}
        text={t('wiki.placeholderHint')}
      />
    </main>
  )
}
