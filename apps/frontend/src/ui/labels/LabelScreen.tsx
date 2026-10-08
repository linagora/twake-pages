import type { ReactElement } from 'react'
import { useParams } from 'react-router'

import { useI18n } from '@/ui/i18n/useI18n'
import { PlaceholderScreen } from '@/ui/PlaceholderScreen'

export function LabelScreen(): ReactElement {
  const { t } = useI18n()
  const { name = '' } = useParams()
  return <PlaceholderScreen title={t('labels.title', { name })} />
}
