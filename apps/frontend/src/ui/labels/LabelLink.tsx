import { Link } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink } from 'react-router'

import { LabelChip } from '@/ds/LabelChip'
import { useI18n } from '@/ui/i18n/useI18n'

/**
 * The chip of a label, leading to its pages at `to`, the label screen, and
 * telling how many they are when `pages` is given.
 */
export function LabelLink({
  to,
  name,
  pages
}: {
  to: string
  name: string
  pages?: number
}): ReactElement {
  const { t } = useI18n()
  return (
    <Link
      component={RouterLink}
      to={to}
      underline="none"
      {...(pages === undefined
        ? {}
        : { 'aria-label': t('labels.entry', { name, smart_count: pages }) })}
    >
      <LabelChip name={name} count={pages} />
    </Link>
  )
}
