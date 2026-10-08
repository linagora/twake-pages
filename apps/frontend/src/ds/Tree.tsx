import { Bottom, Icon, Right } from '@linagora/twake-icons'
import { Box } from '@linagora/twake-mui'
import {
  useId,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode
} from 'react'

export interface TreeEntry<Entry> {
  id: string
  children: Entry[]
}

/**
 * What the element drawing an entry takes, to be one item of the tree. It
 * owns the group of the entries under it, so its label, its `children`, names
 * it: the titles in that group stay out of its name. Its level and place are
 * given, not left to be counted through `aria-owns`.
 */
export interface TreeItemProps {
  id: string
  role: 'treeitem'
  'aria-labelledby': string
  'aria-owns'?: string
  'aria-level': number
  'aria-setsize': number
  'aria-posinset': number
  'aria-expanded'?: boolean
  'aria-current'?: 'page'
  tabIndex: number
  onFocus: () => void
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  children: ReactElement
}

interface Shown<Entry> {
  entry: Entry
  parent: string | null
}

const LIST = { m: 0, p: 0, listStyle: 'none' } as const

/**
 * The navigation tree of the ARIA Authoring Practices: `item` draws each entry
 * as a link around its `label`, and the entries under it show once it is
 * expanded. The tree is one stop of the tab order, and the arrows move through
 * the entries shown.
 */
export function Tree<Entry extends TreeEntry<Entry>>({
  labelledBy,
  entries,
  current,
  expanded,
  onExpand,
  label,
  item
}: {
  labelledBy: string
  entries: Entry[]
  current: string | null
  expanded: ReadonlySet<string>
  onExpand: (id: string, expanded: boolean) => void
  label: (entry: Entry) => string
  item: (entry: Entry, props: TreeItemProps) => ReactElement
}): ReactElement {
  const base = useId()
  const itemId = (id: string) => `${base}item-${id}`
  const labelId = (id: string) => `${base}label-${id}`
  const groupId = (id: string) => `${base}group-${id}`
  const [focused, setFocused] = useState<string | null>(null)

  const shown = shownOf(entries, expanded)
  // Back in the tree, the focus goes to the entry it left, else the open page.
  const stop =
    [focused, current].find(id => shown.some(({ entry }) => entry.id === id)) ??
    shown[0]?.entry.id

  const moveTo = (id: string | null | undefined) => {
    if (id) document.getElementById(itemId(id))?.focus()
  }

  const onKeyDown = (
    entry: Entry,
    open: boolean,
    event: KeyboardEvent<HTMLElement>
  ) => {
    const at = shown.findIndex(each => each.entry.id === entry.id)
    switch (event.key) {
      case 'ArrowDown':
        moveTo(shown[at + 1]?.entry.id)
        break
      case 'ArrowUp':
        moveTo(shown[at - 1]?.entry.id)
        break
      case 'Home':
        moveTo(shown[0]?.entry.id)
        break
      case 'End':
        moveTo(shown.at(-1)?.entry.id)
        break
      case 'ArrowRight':
        if (open) moveTo(entry.children[0]?.id)
        else if (entry.children.length > 0) onExpand(entry.id, true)
        break
      case 'ArrowLeft':
        if (open) onExpand(entry.id, false)
        else moveTo(shown[at]?.parent)
        break
      case 'Enter':
        // Whatever `item` draws opens. With a modifier, the browser opens a
        // link elsewhere.
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
          return
        }
        event.currentTarget.click()
        break
      default:
        return
    }
    event.preventDefault()
  }

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
              'aria-labelledby': labelId(entry.id),
              ...(open && { 'aria-owns': groupId(entry.id) }),
              'aria-level': level,
              'aria-setsize': siblings.length,
              'aria-posinset': index + 1,
              ...(parent && { 'aria-expanded': open }),
              ...(entry.id === current && { 'aria-current': 'page' as const }),
              tabIndex: entry.id === stop ? 0 : -1,
              onFocus: () => {
                setFocused(entry.id)
              },
              onKeyDown: event => {
                onKeyDown(entry, open, event)
              },
              children: <span id={labelId(entry.id)}>{label(entry)}</span>
            })}
          </Row>
          {open && (
            <Box
              component="ul"
              id={groupId(entry.id)}
              role="group"
              aria-labelledby={labelId(entry.id)}
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

/** The entries the arrows move through, in their order on screen. */
function shownOf<Entry extends TreeEntry<Entry>>(
  entries: Entry[],
  expanded: ReadonlySet<string>,
  parent: string | null = null
): Shown<Entry>[] {
  return entries.flatMap(entry => [
    { entry, parent },
    ...(expanded.has(entry.id)
      ? shownOf(entry.children, expanded, entry.id)
      : [])
  ])
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
