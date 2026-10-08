import { Bottom, Icon, Right } from '@linagora/twake-icons'
import { Box } from '@linagora/twake-mui'
import { useId, type ReactElement, type ReactNode } from 'react'

export interface TreeEntry<Entry> {
  id: string
  children: Entry[]
}

/**
 * What the element drawing an entry takes, to be one item of the tree. Its
 * level and place are given, not owned: `aria-owns` would add the names of the
 * entries under it to its own.
 */
export interface TreeItemProps {
  id: string
  role: 'treeitem'
  'aria-level': number
  'aria-setsize': number
  'aria-posinset': number
  'aria-expanded'?: boolean
  'aria-current'?: 'page'
}

const LIST = { m: 0, p: 0, listStyle: 'none' } as const

/**
 * The navigation tree of the ARIA Authoring Practices: `item` draws each entry
 * as a link, and the entries under it show once it is expanded.
 */
export function Tree<Entry extends TreeEntry<Entry>>({
  labelledBy,
  entries,
  current,
  expanded,
  onExpand,
  item
}: {
  labelledBy: string
  entries: Entry[]
  current: string | null
  expanded: ReadonlySet<string>
  onExpand: (id: string, expanded: boolean) => void
  item: (entry: Entry, props: TreeItemProps) => ReactElement
}): ReactElement {
  const base = useId()
  const itemId = (id: string) => `${base}item-${id}`

  const branch = (siblings: Entry[], level: number): ReactElement[] =>
    siblings.map((entry, index) => {
      const parent = entry.children.length > 0
      const open = parent && expanded.has(entry.id)
      return (
        <Box component="li" role="none" key={entry.id}>
          <Row level={level} current={entry.id === current}>
            <Chevron
              shown={parent}
              open={open}
              onToggle={() => {
                onExpand(entry.id, !open)
              }}
            />
            {item(entry, {
              id: itemId(entry.id),
              role: 'treeitem',
              'aria-level': level,
              'aria-setsize': siblings.length,
              'aria-posinset': index + 1,
              ...(parent && { 'aria-expanded': open }),
              ...(entry.id === current && { 'aria-current': 'page' as const })
            })}
          </Row>
          {open && (
            <Box
              component="ul"
              role="group"
              aria-labelledby={itemId(entry.id)}
              sx={LIST}
            >
              {branch(entry.children, level + 1)}
            </Box>
          )}
        </Box>
      )
    })

  return (
    <Box component="ul" role="tree" aria-labelledby={labelledBy} sx={LIST}>
      {branch(entries, 1)}
    </Box>
  )
}

function Row({
  level,
  current,
  children
}: {
  level: number
  current: boolean
  children: ReactNode
}): ReactElement {
  return (
    <Box
      sx={theme => ({
        display: 'flex',
        alignItems: 'center',
        pl: 1 + (level - 1) * 2,
        pr: 1,
        mx: 1,
        borderRadius: 1,
        bgcolor: current ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: current ? 'action.selected' : 'action.hover' },
        '& > a': {
          flex: 1,
          minWidth: 0,
          py: 0.75,
          color: 'text.primary',
          fontWeight: current ? 600 : 400,
          textDecoration: 'none',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          borderRadius: 1,
          '&:focus-visible': {
            outline: `2px solid ${theme.vars.palette.primary.main}`
          }
        }
      })}
    >
      {children}
    </Box>
  )
}

// For the mouse: the keyboard expands and collapses from the item itself.
function Chevron({
  shown,
  open,
  onToggle
}: {
  shown: boolean
  open: boolean
  onToggle: () => void
}): ReactElement {
  return (
    <Box
      component="span"
      aria-hidden
      onClick={shown ? onToggle : undefined}
      sx={{
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        mr: 0.5,
        color: 'text.secondary',
        cursor: shown ? 'pointer' : 'default',
        visibility: shown ? 'visible' : 'hidden'
      }}
    >
      <Icon icon={open ? Bottom : Right} size={12} />
    </Box>
  )
}
