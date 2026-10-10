import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography
} from '@linagora/twake-mui'
import { useId, useState, type ReactElement } from 'react'

import type { Page } from '@/domain/page'
import { buildTree, type TreeNode } from '@/domain/tree'
import { useI18n } from '@/ui/i18n/useI18n'
import { MoveStatus, useMoveTo } from '@/ui/page/useMoveTo'
import { useTree } from '@/ui/wiki/queries'

// The places among the pages under the parent, besides after one of them,
// named by its id: the place stays after that page as the tree changes.
const FIRST = 'first'
const LAST = 'last'

/**
 * The dialog that moves `page` from its menu, under another page or to the
 * top of the tree, and the status that tells screen readers where it went.
 */
export function MovePageDialog({
  page,
  open,
  onClose
}: {
  page: Page
  open: boolean
  onClose: () => void
}): ReactElement {
  const titleId = useId()
  const [moved, setMoved] = useState('')
  const [said, setSaid] = useState('')
  return (
    <>
      <MoveStatus said={said} />
      <Dialog
        open={open}
        onClose={onClose}
        aria-labelledby={titleId}
        size="small"
        slotProps={{
          transition: {
            // Said once the dialog is gone: until then, the screen behind it,
            // and the status with it, is hidden from screen readers.
            onExited: () => {
              setSaid(moved)
            }
          }
        }}
      >
        <MoveForm
          page={page}
          titleId={titleId}
          onClose={onClose}
          onMoved={where => {
            setMoved(where)
            onClose()
          }}
        />
      </Dialog>
    </>
  )
}

function MoveForm({
  page,
  titleId,
  onClose,
  onMoved
}: {
  page: Page
  titleId: string
  onClose: () => void
  onMoved: (where: string) => void
}): ReactElement {
  const { t } = useI18n()
  const tree = useTree(page.wikiId)
  const { move, moveTo, failure } = useMoveTo(page.wikiId)
  const [parentId, setParentId] = useState(page.parentId)
  const [chosen, setChosen] = useState<string | null>(null)

  const top = buildTree(tree.data?.pages ?? [])
  const parents = parentsFor(top, page.id)
  // A parent gone from the tree while the dialog is open gives way to the top
  // of the tree, shown as it is sent.
  const parent = parents.find(({ node }) => node.id === parentId)?.node ?? null
  const there = parent ? parent.children : top
  const at = there.findIndex(node => node.id === page.id)
  const siblings = there.filter(node => node.id !== page.id)
  // Until another is chosen, the place of the page under its own parent, and
  // the last under another.
  const { place, index } = placeAmong(siblings, chosen ?? placeAt(at, siblings))

  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        void moveTo(page, { parent, siblings, index }).then(
          ({ said }) => {
            onMoved(said)
          },
          // The dialog says so, and stays open.
          () => undefined
        )
      }}
    >
      <DialogTitle id={titleId}>
        {t('movePage.title', { title: page.title })}
      </DialogTitle>
      <DialogContent>
        <TextField
          select
          fullWidth
          margin="dense"
          label={t('movePage.parent')}
          value={parent?.id ?? ''}
          onChange={event => {
            setParentId(event.target.value || null)
            setChosen(null)
          }}
          slotProps={{
            select: { native: true },
            inputLabel: { shrink: true }
          }}
        >
          <option value="">{t('movePage.top')}</option>
          {parents.map(({ node, path }) => (
            <option key={node.id} value={node.id}>
              {path}
            </option>
          ))}
        </TextField>
        <TextField
          select
          fullWidth
          margin="dense"
          label={t('movePage.place')}
          value={place}
          onChange={event => {
            setChosen(event.target.value)
          }}
          slotProps={{
            select: { native: true },
            inputLabel: { shrink: true }
          }}
        >
          <option value={FIRST}>{t('movePage.first')}</option>
          {siblings.map(sibling => (
            <option key={sibling.id} value={sibling.id}>
              {t('movePage.after', { title: sibling.title })}
            </option>
          ))}
          <option value={LAST}>{t('movePage.last')}</option>
        </TextField>
        {failure !== null && (
          <Typography role="alert" color="error">
            {failure}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button variant="text" onClick={onClose}>
          {t('movePage.cancel')}
        </Button>
        <Button
          type="submit"
          disabled={!tree.isSuccess || move.isPending || index === at}
        >
          {t('movePage.move')}
        </Button>
      </DialogActions>
    </form>
  )
}

/** The place of the page at `at` among the others there, its `siblings`. */
function placeAt(at: number, siblings: TreeNode[]): string {
  if (at < 0) return LAST
  return siblings[at - 1]?.id ?? FIRST
}

/**
 * The place `wanted` among `siblings`, and its index there. Once the page it
 * comes after is gone, the place is the last, never after another page.
 */
function placeAmong(
  siblings: TreeNode[],
  wanted: string
): { place: string; index: number } {
  if (wanted === FIRST) return { place: FIRST, index: 0 }
  const after = siblings.findIndex(node => node.id === wanted)
  return after < 0
    ? { place: LAST, index: siblings.length }
    : { place: wanted, index: after + 1 }
}

/**
 * The pages `pageId` may go under, in the order of the tree, each named by its
 * path: all but itself and the pages under it.
 */
function parentsFor(
  nodes: TreeNode[],
  pageId: string,
  above: string[] = []
): { node: TreeNode; path: string }[] {
  return nodes
    .filter(node => node.id !== pageId)
    .flatMap(node => {
      const path = [...above, node.title]
      return [
        { node, path: path.join(' / ') },
        ...parentsFor(node.children, pageId, path)
      ]
    })
}
