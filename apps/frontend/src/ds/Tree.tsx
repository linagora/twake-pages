import { Bottom, Icon, Plus, Right } from '@linagora/twake-icons'
import { Box } from '@linagora/twake-mui'
import {
  useId,
  useLayoutEffect,
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

/** An entry made under another from its row, with the mouse. */
export interface TreeAdd<Entry> {
  label: (parent: Entry) => string
  onAdd: (parent: Entry) => void
}

/**
 * A place in the tree: `index` among the entries under `parent`, or at the
 * top. Where an entry is, `siblings` holds it; where a moved one goes, they
 * leave it out.
 */
export interface TreePlace<Entry> {
  /** Null at the top of the tree. */
  parent: Entry | null
  /** In their order. */
  siblings: Entry[]
  index: number
}

interface Shown<Entry> {
  entry: Entry
  parent: string | null
}

/** An entry a key moved, and where it was until the move shows. */
interface Moving {
  id: string
  parent: string | null
  index: number
}

const LIST = { m: 0, p: 0, listStyle: 'none' } as const

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft']

const itemIdOf = (base: string, id: string) => `${base}item-${id}`

/**
 * The navigation tree of the ARIA Authoring Practices: `item` draws each entry
 * as a link around its `label`, and the entries under it show once it is
 * expanded. The tree is one stop of the tab order, and the arrows move through
 * the entries shown.
 *
 * With `onMove`, Alt+Shift and an arrow move the entry that has the focus: up
 * or down among its siblings, under the sibling before it, last, or out to its
 * parent's level, right after its parent. The tree takes one move at a time,
 * and is busy until it shows, unless `onMove` answers it never will; the entry
 * keeps the focus in its new place.
 *
 * Unlike Twake Tasks, whose cards move from the keyboard with dnd-kit's
 * keyboard sensor (Space or Enter picks a card up, the arrows carry it, Space
 * or Enter drops it), an entry moves one step per chord: here Enter opens the
 * entry and the arrows move the focus, an entry also goes into and out of a
 * level, and dragging comes later.
 */
export function Tree<Entry extends TreeEntry<Entry>>({
  labelledBy,
  entries,
  current,
  expanded,
  onExpand,
  label,
  item,
  add,
  onMove
}: {
  labelledBy: string
  entries: Entry[]
  current: string | null
  expanded: ReadonlySet<string>
  onExpand: (id: string, expanded: boolean) => void
  label: (entry: Entry) => string
  item: (entry: Entry, props: TreeItemProps) => ReactElement
  add?: TreeAdd<Entry> | undefined
  /** Answers whether the tree is to show the entry in its new place. */
  onMove?:
    ((entry: Entry, to: TreePlace<Entry>) => Promise<boolean>) | undefined
}): ReactElement {
  const base = useId()
  const itemId = (id: string) => itemIdOf(base, id)
  const labelId = (id: string) => `${base}label-${id}`
  const groupId = (id: string) => `${base}group-${id}`
  const [focused, setFocused] = useState<string | null>(null)
  const [moving, setMoving] = useState<Moving | null>(null)
  // Drawn in its new place, the row of a moved entry is a new element, or one
  // moved in the page: it lost the focus on the way, and takes it back.
  const [moved, setMoved] = useState<{ id: string } | null>(null)
  if (moving && !isAt(entries, moving)) {
    setMoving(null)
    setMoved({ id: moving.id })
  }

  useLayoutEffect(() => {
    if (moved) document.getElementById(itemIdOf(base, moved.id))?.focus()
  }, [base, moved])

  const shown = shownOf(entries, expanded)
  // Back in the tree, the focus goes to the entry it left, else the open page.
  const stop =
    [focused, current].find(id => shown.some(({ entry }) => entry.id === id)) ??
    shown[0]?.entry.id

  const focusOn = (id: string | null | undefined) => {
    if (id) document.getElementById(itemId(id))?.focus()
  }

  const moveEntry = (
    entry: Entry,
    event: KeyboardEvent<HTMLElement>,
    onMove: (entry: Entry, to: TreePlace<Entry>) => Promise<boolean>
  ) => {
    if (!ARROWS.includes(event.key)) return
    event.preventDefault()
    const at = whereIs(entries, entry.id)
    const to = at && placeFor(entries, at, event.key)
    if (moving || !at || !to) return
    const started = {
      id: entry.id,
      parent: at.parent?.id ?? null,
      index: at.index
    }
    setMoving(started)
    if (to.parent && !expanded.has(to.parent.id)) onExpand(to.parent.id, true)
    // Refused, or never to show: the tree takes the next move.
    const letGo = () => {
      setMoving(now => (now === started ? null : now))
    }
    void onMove(entry, to).then(shows => {
      if (!shows) letGo()
    }, letGo)
  }

  const onKeyDown = (
    entry: Entry,
    open: boolean,
    event: KeyboardEvent<HTMLElement>
  ) => {
    if (event.altKey && event.shiftKey) {
      if (onMove && !event.ctrlKey && !event.metaKey) {
        moveEntry(entry, event, onMove)
      }
      return
    }
    const at = shown.findIndex(each => each.entry.id === entry.id)
    switch (event.key) {
      case 'ArrowDown':
        focusOn(shown[at + 1]?.entry.id)
        break
      case 'ArrowUp':
        focusOn(shown[at - 1]?.entry.id)
        break
      case 'Home':
        focusOn(shown[0]?.entry.id)
        break
      case 'End':
        focusOn(shown.at(-1)?.entry.id)
        break
      case 'ArrowRight':
        if (open) focusOn(entry.children[0]?.id)
        else if (entry.children.length > 0) onExpand(entry.id, true)
        break
      case 'ArrowLeft':
        if (open) onExpand(entry.id, false)
        else focusOn(shown[at]?.parent)
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
                // The focus went to another entry: a move that never showed
                // is let go.
                if (moving && moving.id !== entry.id) setMoving(null)
              },
              onKeyDown: event => {
                onKeyDown(entry, open, event)
              },
              children: <span id={labelId(entry.id)}>{label(entry)}</span>
            })}
            {add && (
              <Add
                label={add.label(entry)}
                onAdd={() => {
                  add.onAdd(entry)
                }}
              />
            )}
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
    <Box
      component="ul"
      role="tree"
      aria-labelledby={labelledBy}
      aria-busy={moving !== null}
      sx={LIST}
    >
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

// The maths of a move stay beside the keys that make it. Twake Tasks keeps
// its drag maths in application/boardDrag.ts, for a board drawn in ui/; this
// tree is a ds/ component, generic over its entries, and ds/ imports no other
// layer.

function whereIs<Entry extends TreeEntry<Entry>>(
  entries: Entry[],
  id: string,
  parent: Entry | null = null
): TreePlace<Entry> | undefined {
  const index = entries.findIndex(entry => entry.id === id)
  if (index >= 0) return { parent, siblings: entries, index }
  for (const entry of entries) {
    const place = whereIs(entry.children, id, entry)
    if (place) return place
  }
  return undefined
}

function isAt<Entry extends TreeEntry<Entry>>(
  entries: Entry[],
  { id, parent, index }: Moving
): boolean {
  const place = whereIs(entries, id)
  return (
    place !== undefined &&
    (place.parent?.id ?? null) === parent &&
    place.index === index
  )
}

/** Where Alt+Shift and the arrow `key` move the entry at `at`, if it can go. */
function placeFor<Entry extends TreeEntry<Entry>>(
  entries: Entry[],
  at: TreePlace<Entry>,
  key: string
): TreePlace<Entry> | undefined {
  const { parent, siblings, index } = at
  const others = siblings.filter((_, each) => each !== index)
  const before = siblings[index - 1]
  switch (key) {
    case 'ArrowUp':
      return before && { parent, siblings: others, index: index - 1 }
    case 'ArrowDown':
      return index < others.length
        ? { parent, siblings: others, index: index + 1 }
        : undefined
    case 'ArrowRight':
      // Under the sibling before it, even when the entries under that one
      // show between them.
      return (
        before && {
          parent: before,
          siblings: before.children,
          index: before.children.length
        }
      )
    default: {
      // Out to the parent's level, right after the parent.
      const outer = parent && whereIs(entries, parent.id)
      return outer ? { ...outer, index: outer.index + 1 } : undefined
    }
  }
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

// The square holding an icon of a row: its chevron, or its +.
const ROW_ICON = {
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  color: 'text.secondary'
} as const

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
        ...ROW_ICON,
        mr: 0.5,
        cursor: shown ? 'pointer' : 'default',
        visibility: shown ? 'visible' : 'hidden'
      }}
    >
      <Icon icon={open ? Bottom : Right} size={12} />
    </Box>
  )
}

// For the mouse too, shown on the row it points at, and always on a touch
// screen. The caller offers the keyboard the same action outside the tree.
function Add({
  label,
  onAdd
}: {
  label: string
  onAdd: () => void
}): ReactElement {
  return (
    <Box
      component="span"
      aria-hidden
      title={label}
      onClick={onAdd}
      sx={{
        ...ROW_ICON,
        ml: 0.5,
        borderRadius: 1,
        cursor: 'pointer',
        visibility: 'hidden',
        '*:hover > &': { visibility: 'visible' },
        '&:hover': { bgcolor: 'action.hover' },
        '@media (hover: none)': { visibility: 'visible' }
      }}
    >
      <Icon icon={Plus} size={12} />
    </Box>
  )
}
