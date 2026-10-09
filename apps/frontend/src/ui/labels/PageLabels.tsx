import { Icon, Pen } from '@linagora/twake-icons'
import { IconButton, Typography } from '@linagora/twake-mui'
import { useState, type ReactElement } from 'react'

import { Chips, Inline } from '@/ds/SidePanel'
import type { Page } from '@/domain/page'
import { useI18n } from '@/ui/i18n/useI18n'
import { LabelLink } from '@/ui/labels/LabelLink'
import { LabelsPicker } from '@/ui/labels/LabelsPicker'
import { useWiki } from '@/ui/wiki/queries'

/**
 * The labels of the page, each leading to the pages that carry it, which an
 * editor changes but on a page in the trash. Twake Tasks lists every property
 * of a task, labels or none; a page shows no labels to a person who can give
 * it none.
 */
export function PageLabels({ page }: { page: Page }): ReactElement | null {
  const { t } = useI18n()
  const wiki = useWiki(page.wikiId)
  const [labelling, setLabelling] = useState<HTMLElement | null>(null)
  const editable =
    wiki.data !== undefined &&
    wiki.data.role !== 'viewer' &&
    page.deletedAt === null
  // The page may go to the trash, or the person stop being an editor, while
  // the picker is open: the labels cannot change any more, so it closes.
  if (labelling !== null && !editable) setLabelling(null)
  if (page.labels.length === 0 && !editable) return null

  return (
    <div className="u-mt-half">
      <Inline>
        {page.labels.length > 0 ? (
          <Chips label={t('labels.ofPage')}>
            {page.labels.map(name => (
              <li key={name}>
                <LabelLink
                  to={`../labels/${encodeURIComponent(name)}`}
                  name={name}
                />
              </li>
            ))}
          </Chips>
        ) : (
          <Typography variant="body2" color="textSecondary">
            {t('labels.none')}
          </Typography>
        )}
        {editable && (
          <IconButton
            size="small"
            aria-label={t('labels.edit')}
            onClick={event => {
              setLabelling(event.currentTarget)
            }}
          >
            <Icon icon={Pen} size={14} />
          </IconButton>
        )}
      </Inline>
      {labelling && (
        <LabelsPicker
          page={page}
          anchor={labelling}
          onClose={() => {
            setLabelling(null)
          }}
        />
      )}
    </div>
  )
}
