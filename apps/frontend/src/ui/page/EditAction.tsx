import { Icon, Pen } from '@linagora/twake-icons'
import { Button } from '@linagora/twake-mui'
import type { ReactElement } from 'react'
import { Link as RouterLink } from 'react-router'

import { useI18n } from '@/ui/i18n/useI18n'
import { useEditable } from '@/ui/page/useEditable'

/** Leads the person who writes the page to its editor, at `to`. */
export function EditAction({
  wikiId,
  pageId,
  to
}: {
  wikiId: string
  pageId: string
  to: string
}): ReactElement | null {
  const { t } = useI18n()
  const editable = useEditable(wikiId, pageId)
  if (!editable) return null

  return (
    <Button
      component={RouterLink}
      to={to}
      variant="secondary"
      startIcon={<Icon icon={Pen} />}
    >
      {t('page.edit')}
    </Button>
  )
}
