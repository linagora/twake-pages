import { Link } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink } from 'react-router'

import { LabelChip } from '@/ds/LabelChip'
import { Chips } from '@/ds/SidePanel'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'

/** The labels of the page, each leading to the pages that carry it. */
export function PageLabels({ page }: { page: Page }): ReactElement | null {
  const { t } = useI18n()
  if (page.labels.length === 0) return null

  return (
    <div className="u-mt-half">
      <Chips label={t('labels.ofPage')}>
        {page.labels.map(name => (
          <li key={name}>
            <Link
              component={RouterLink}
              to={`../labels/${encodeURIComponent(name)}`}
              underline="none"
            >
              <LabelChip name={name} />
            </Link>
          </li>
        ))}
      </Chips>
    </div>
  )
}
