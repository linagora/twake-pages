import { FileOutline } from '@linagora/twake-icons'
import { ListSubheader, Typography } from '@linagora/twake-mui'
import { useId, useState, type ReactElement } from 'react'
import { Link as RouterLink, useNavigate, useParams } from 'react-router'

import { EmptyState, ListSkeleton } from '@/ds/EmptyState'
import { Tree } from '@/ds/Tree'
import type { TreePage } from '@/domain/page'
import { ancestorsOf, buildTree } from '@/domain/tree'
import { useI18n } from '@/ui/i18n/useI18n'
import { NewPageDialog } from '@/ui/page/NewPageDialog'
import { moveAnnouncement, MoveStatus, useMoveTo } from '@/ui/page/useMoveTo'
import { useTree, useWiki } from '@/ui/wiki/queries'

export function PageTree({ wikiId }: { wikiId: string }): ReactElement {
  const { t } = useI18n()
  const navigate = useNavigate()
  const titleId = useId()
  const { pageId = null } = useParams()
  const wiki = useWiki(wikiId)
  const tree = useTree(wikiId)
  const { moveTo, failure } = useMoveTo(wikiId)
  const pages = tree.data?.pages ?? []
  const path =
    pageId === null ? [] : ancestorsOf(pages, pageId).map(page => page.id)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [parent, setParent] = useState<TreePage | null>(null)
  const [said, setSaid] = useState('')
  const editable = wiki.data !== undefined && wiki.data.role !== 'viewer'

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
          // The keyboard finds New child page in the menu of the page.
          add={
            editable
              ? {
                  label: page => t('newPage.under', { title: page.title }),
                  onAdd: setParent
                }
              : undefined
          }
          onMove={
            editable
              ? async (page, to) => {
                  const { shown, said } = await moveTo(page, to)
                  setSaid(said)
                  return shown
                }
              : undefined
          }
          dragWords={{
            picked: page => t('drag.picked', { title: page.title }),
            over: (page, to) =>
              to
                ? moveAnnouncement(t, page.title, to, {
                    under: 'drag.under',
                    toTop: 'drag.toTop'
                  })
                : t('drag.nowhere', { title: page.title }),
            canceled: page => t('drag.canceled', { title: page.title })
          }}
        />
      )}
      {failure !== null && (
        <Typography role="alert" className="u-ph-1">
          {failure}
        </Typography>
      )}
      <MoveStatus said={said} />
      {parent && (
        <NewPageDialog
          wikiId={wikiId}
          parent={parent}
          onClose={() => {
            setParent(null)
          }}
          onCreated={page => {
            // The tree stays for the new page.
            setParent(null)
            void navigate(`pages/${page.id}`)
          }}
        />
      )}
    </>
  )
}
