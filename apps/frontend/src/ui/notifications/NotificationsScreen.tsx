import type { ReactElement } from 'react'

import { useI18n } from '@/ui/i18n/useI18n'
import { PlaceholderScreen } from '@/ui/PlaceholderScreen'

export function NotificationsScreen(): ReactElement {
  const { t } = useI18n()
  return <PlaceholderScreen title={t('notifications.title')} />
}
