import { Alert } from '@linagora/twake-mui'
import type { ReactElement } from 'react'

import { useI18n } from '@/ui/i18n/useI18n'

/**
 * The hosts of the draft's images that the browser will not show, as the
 * app's Content Security Policy takes images from the sources it `added` to
 * its own only (ADR 012: images go in by link, with no upload).
 */
export function ImagesNotShown({
  hosts,
  added
}: {
  hosts: string[]
  added: string[]
}): ReactElement {
  const { t, lang } = useI18n()
  const list = new Intl.ListFormat(lang, { type: 'conjunction' })
  // As written, without keywords such as 'self'.
  const allowed = added.filter(source => !source.startsWith("'"))
  return (
    <Alert severity="warning" role="status" className="u-mb-1">
      {allowed.length > 0
        ? t('editor.imagesNotShown', {
            hosts: list.format(hosts),
            allowed: list.format(allowed)
          })
        : t('editor.noImagesShown', { hosts: list.format(hosts) })}
    </Alert>
  )
}
