import { FileOutline } from '@linagora/twake-icons'
import { ListSubheader, Typography } from '@linagora/twake-mui'
import { useId, useState, type ReactElement } from 'react'
import { Link as RouterLink, useParams } from 'react-router'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { Tree } from '@/ds/Tree'
import { ancestorsOf, buildTree } from '@/domain/tree'
import { useI18n } from '@/ui/i18n/useI18n'
import { useTree } from '@/ui/wiki/queries'

export function PageTree({ wikiId }: { wikiId: string }): ReactElement {
  const { t } = useI18n()
  const titleId = useId()
  const { pageId = null } = useParams()
  const tree = useTree(wikiId)
  const pages = tree.data?.pages ?? []
  const path =
    pageId === null ? [] : ancestorsOf(pages, pageId).map(page => page.id)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())

  // The pages above the open one expand each time it changes place: when
  // another page opens, or this one moves.
  const pathKey = path.join(' ')
  const [shownPath, setShownPath] = useState('')
  if (pathKey !== shownPath) {
    setShownPath(pathKey)
    setExpanded(current => new Set([...current, ...path]))
  }

  return (
    <>
      <ListSubheader component="div" id={titleId}>
        {t('tree.title')}
      </ListSubheader>
      {tree.isError && (
        <Typography role="alert" className="u-ph-1">
          {t('tree.loadFailed')}
        </Typography>
      )}
      {tree.isPending && <ListSkeleton label={t('app.loading')} rows={3} />}
      {tree.isSuccess && pages.length === 0 && (
        <EmptyState compact icon={FileOutline} title={t('tree.empty')} />
      )}
      {pages.length > 0 && (
        <Tree
          labelledBy={titleId}
          entries={buildTree(pages)}
          current={pageId}
          expanded={expanded}
          onExpand={(id, open) => {
            setExpanded(current => {
              const next = new Set(current)
              if (open) next.add(id)
              else next.delete(id)
              return next
            })
          }}
          label={page => page.title}
          item={(page, props) => (
            <RouterLink {...props} to={`pages/${page.id}`} />
          )}
        />
      )}
    </>
  )
}
