import { Typography } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import type { VersionSummary } from '@/domain/page'
import { displayName } from '@/domain/person'
import { useI18n } from '@/ui/i18n/useI18n'
import { localTime } from '@/ui/settings/zone'

/** Who published a version and when, and the version it was restored from. */
export function VersionByline({
  version
}: {
  version: VersionSummary
}): ReactElement {
  const { t, lang } = useI18n()
  const published = t('history.published', {
    author: displayName(version.author),
    time: localTime(version.createdAt, lang)
  })
  return (
    <Typography variant="body2" color="textSecondary">
      {version.restoredFrom === null
        ? published
        : `${published} · ${t('history.restoredFrom', { number: version.restoredFrom })}`}
    </Typography>
  )
}
