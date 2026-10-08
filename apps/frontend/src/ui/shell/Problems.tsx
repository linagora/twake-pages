import { Compass, Icon, Left, WarningCircle } from '@linagora/twake-icons'
import { Button, Typography } from '@linagora/twake-mui'
import type { ReactElement, ReactNode } from 'react'
import { Link as RouterLink } from 'react-router'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { useI18n } from '@/ui/i18n/useI18n'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

export function BackToWikis(): ReactElement {
  const { t } = useI18n()
  return (
    <Button
      component={RouterLink}
      to="/"
      variant="secondary"
      startIcon={<Icon icon={Left} />}
    >
      {t('wikis.back')}
    </Button>
  )
}

export function NotFoundScreen(): ReactElement {
  const { t } = useI18n()
  useDocumentTitle(t('problems.notFound'))
  return (
    <main className="u-p-2">
      <EmptyState
        icon={Compass}
        title={t('problems.notFound')}
        text={t('problems.notFoundHint')}
        action={<BackToWikis />}
      />
    </main>
  )
}

/**
 * In place of a wiki or a page that cannot be shown: `missing`, failed to
 * load, or still loading.
 */
export function UnavailableScreen({
  query,
  missing,
  notFound,
  loadFailed,
  action
}: {
  query: { isError: boolean; isPending: boolean }
  missing: boolean
  notFound: string
  loadFailed: string
  action?: ReactNode
}): ReactElement {
  const { t } = useI18n()
  return (
    <main className="u-p-2">
      {missing && (
        <EmptyState
          icon={Compass}
          title={notFound}
          text={t('problems.notFoundHint')}
          action={action}
        />
      )}
      {query.isError && !missing && (
        <Typography role="alert">{loadFailed}</Typography>
      )}
      {query.isPending && <ListSkeleton label={t('app.loading')} />}
    </main>
  )
}

// Rendered by the router in place of a screen that threw while rendering.
export function CrashScreen(): ReactElement {
  const { t } = useI18n()
  return (
    <main className="u-p-2">
      <EmptyState
        tone="error"
        icon={WarningCircle}
        title={t('problems.crash')}
        text={t('problems.crashHint')}
        action={
          <Button
            onClick={() => {
              window.location.reload()
            }}
          >
            {t('problems.reload')}
          </Button>
        }
      />
    </main>
  )
}
