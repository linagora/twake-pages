import { Compass, Icon, Left, WarningCircle } from '@linagora/twake-icons'
import { Button } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink } from 'react-router'

import { EmptyState } from '@/ds/EmptyState'
import { useI18n } from '@/ui/i18n/useI18n'
import { useDocumentTitle } from '@/ui/useDocumentTitle'

function BackToWikis(): ReactElement {
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
