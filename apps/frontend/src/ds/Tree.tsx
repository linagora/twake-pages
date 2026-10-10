import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type UniqueIdentifier
} from '@dnd-kit/core'
import { Bottom, Icon, Plus, Right } from '@linagora/twake-icons'
import { Box } from '@linagora/twake-mui'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode
} from 'react'

import {
  entryAt,
  placeFor,
  placeForDrop,
  pointedAt,
  rowUnderPointer,
  samePlace,
  whereIs,
  withDrop,
  type Pointed,
  type TreeEntry,
  type TreePlace
} from '@/ds/treeMoves'

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

/** What screen readers hear of an entry dragged with the pointer. */
export interface TreeDragWords<Entry> {
  picked: (entry: Entry) => string
  /** Where it would land, if anywhere. */
  over: (entry: Entry, to: TreePlace<Entry> | undefined) => string
  /** Let go where it moves nothing, or with Escape. */
  canceled: (entry: Entry) => string
}

interface Shown<Entry> {
  entry: Entry
  parent: string | null
  level: number
}

/**
 * An entry a key or a drop moved, and where it was until the move shows. A
 * dropped one shows where it was dropped meanwhile.
 */
interface Moving<Entry> {
  id: string
  from: TreePlace<Entry>
  dropped?: TreePlace<Entry>
}

interface Drag {
  id: string
  over: Pointed | undefined
}

const LIST = { m: 0, p: 0, listStyle: 'none' } as const

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft']

// Long enough for a dragged entry to pass over a collapsed one without
// expanding it.
const EXPAND_AFTER_MS = 500

const itemIdOf = (base: string, id: string) => `${base}item-${id}`

// Twake Tasks' sensors: the left button after 6 pixels, one finger after a
// press of 250 ms held within 8 pixels, from anywhere on the row. Without
// the guard that keeps a press in a field of a card from picking it up: a
// row holds no field. dnd-kit's own touch sensor takes one finger alone.
class RowMouseSensor extends MouseSensor {
  static override activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: ({ nativeEvent }: ReactMouseEvent) => nativeEvent.button === 0
    }
  ]
}

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
 * With `onMove` too, the pointer drags an entry by its row, which stays in its
 * place, dimmed with the entries under it, while a copy follows the pointer.
 * The row under the pointer places the entry by the height there: before it
 * from its top quarter, after it from its bottom quarter, last under it from
 * between, which expands a collapsed entry once held there half a second;
 * below the last row, last at the top of the tree. A line shows the place at
 * the level the entry would land at, and the entry it would go under is
 * highlighted. Unlike the cards of Twake Tasks, which make room as one passes,
 * no other row moves until the drop: a row also takes an entry under it, and
 * the line shows at which level. The drop moves the entry as a key does, and
 * `dragWords` say the drag to screen readers.
 *
 * Unlike Twake Tasks, whose cards move from the keyboard with dnd-kit's
 * keyboard sensor (Space or Enter picks a card up, the arrows carry it, Space
 * or Enter drops it), an entry moves one step per chord: here Enter opens the
 * entry and the arrows move the focus, and an entry also goes into and out of
 * a level. dnd-kit drags with the pointer alone.
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
  onMove,
  dragWords
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
  dragWords?: TreeDragWords<Entry> | undefined
}): ReactElement {
  const base = useId()
  const itemId = (id: string) => itemIdOf(base, id)
  const labelId = (id: string) => `${base}label-${id}`
  const groupId = (id: string) => `${base}group-${id}`
  const treeId = `${base}tree`
  const [focused, setFocused] = useState<string | null>(null)
  const [moving, setMoving] = useState<Moving<Entry> | null>(null)
  // Drawn in its new place, the row of a moved entry is a new element, or one
  // moved in the page: it lost the focus on the way, and takes it back.
  const [moved, setMoved] = useState<{ id: string } | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // What screen readers hear next of a drag: dnd-kit asks for it right after
  // the handler of the same event, before the tree draws what it set.
  const saying = useRef<string | undefined>(undefined)
  const sensors = useSensors(
    useSensor(RowMouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 }
    })
  )
  if (moving && !samePlace(whereIs(entries, moving.id), moving.from)) {
    setMoving(null)
    setMoved({ id: moving.id })
  }

  useLayoutEffect(() => {
    if (moved) document.getElementById(itemIdOf(base, moved.id))?.focus()
  }, [base, moved])

  // As Twake Tasks' `landed`, a drop stays shown until the entries change.
  // Unlike Tasks, whose useMoveTask moves a task in the cache before the
  // answer, the tree keeps it apart from the entries it is given: the place
  // of a page is a key the backend makes, which the keys and the dialog wait
  // for too.
  const drawn = moving?.dropped
    ? withDrop(entries, moving.id, moving.dropped)
    : entries
  const shown = shownOf(drawn, expanded)
  const landingFor = (id: string, over: Pointed | undefined) =>
    over === undefined || moving || !onMove
      ? undefined
      : placeForDrop(entries, expanded, id, over)
  const landing = drag ? landingFor(drag.id, drag.over) : undefined
  const expanding =
    landing?.parent &&
    landing.parent.children.length > 0 &&
    !expanded.has(landing.parent.id)
      ? landing.parent.id
      : null
  const expand = useEffectEvent((id: string) => {
    onExpand(id, true)
  })
  useEffect(() => {
    if (expanding === null) return
    const timer = setTimeout(() => {
      expand(expanding)
    }, EXPAND_AFTER_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [expanding])
  const dragged = drag && shown.find(({ entry }) => entry.id === drag.id)
  const entryOf = (id: UniqueIdentifier) =>
    entryAt(whereIs(entries, String(id)))
  // Back in the tree, the focus goes to the entry it left, else the open page.
  const stop =
    [focused, current].find(id => shown.some(({ entry }) => entry.id === id)) ??
    shown[0]?.entry.id

  const focusOn = (id: string | null | undefined) => {
    if (id) document.getElementById(itemId(id))?.focus()
  }

  const startMove = (
    entry: Entry,
    at: TreePlace<Entry>,
    to: TreePlace<Entry>,
    onMove: (entry: Entry, to: TreePlace<Entry>) => Promise<boolean>,
    dropped = false
  ) => {
    const started: Moving<Entry> = {
      id: entry.id,
      from: at,
      ...(dropped && { dropped: to })
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
    startMove(entry, at, to, onMove)
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

  const dragTo = (id: string, over: Pointed | undefined) => {
    const entry = entryOf(id)
    const to = landingFor(id, over)
    if (dragWords && entry) saying.current = dragWords.over(entry, to)
    // The tree draws a new place, not each move of the pointer within one.
    setDrag(now =>
      now?.id === id && samePlace(landingFor(id, now.over), to)
        ? now
        : { id, over }
    )
  }

  const drop = (id: string, over: Pointed | undefined) => {
    const at = whereIs(entries, id)
    const entry = entryAt(at)
    const to = landingFor(id, over)
    setDrag(null)
    // A drop that moves the entry is said once it shows, as a key's move.
    saying.current = entry && !to ? dragWords?.canceled(entry) : undefined
    if (onMove && at && entry && to) startMove(entry, at, to, onMove, true)
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const entry = entryOf(active.id)
      return entry && dragWords?.picked(entry)
    },
    onDragMove: () => saying.current,
    // Said by the move that brings the pointer there.
    onDragOver: () => undefined,
    onDragEnd: () => saying.current,
    onDragCancel: ({ active }) => {
      const entry = entryOf(active.id)
      return entry && dragWords?.canceled(entry)
    }
  }

  const branch = (
    siblings: Entry[],
    level: number,
    under: string | null
  ): ReactElement[] => {
    const rows = siblings.map((entry, index) => {
      const parent = entry.children.length > 0
      const open = parent && expanded.has(entry.id)
      return (
        <Box
          component="li"
          role="none"
          key={entry.id}
          sx={entry.id === drag?.id ? DIMMED : undefined}
        >
          <Row
            id={entry.id}
            movable={onMove !== undefined}
            level={level}
            current={entry.id === current}
            highlighted={landing?.parent?.id === entry.id}
          >
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
                // The focus went to another entry: a key's move that never
                // showed is let go. A drop's stays, shown where it was
                // dropped: the press of the next drag focuses its row.
                if (moving && !moving.dropped && moving.id !== entry.id) {
                  setMoving(null)
                }
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
          {!open && landing?.parent?.id === entry.id && (
            <DropLine level={level + 1} />
          )}
          {open && (
            <Box
              component="ul"
              id={groupId(entry.id)}
              role="group"
              aria-labelledby={labelId(entry.id)}
              sx={LIST}
            >
              {branch(entry.children, level + 1, entry.id)}
            </Box>
          )}
        </Box>
      )
    })
    if (!landing || (landing.parent?.id ?? null) !== under) return rows
    const before = entryAt(landing)
    const at = before
      ? siblings.findIndex(each => each.id === before.id)
      : siblings.length
    return rows.toSpliced(
      at,
      0,
      <DropLine key="drop" level={level} component="li" />
    )
  }

  // Drawn for every tree, so that rows stay the same elements as the person
  // comes to edit the wiki, or no longer does.
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rowUnderPointer(treeId)}
      accessibility={{
        announcements,
        // Theirs would speak of the space bar, which opens a page here.
        screenReaderInstructions: { draggable: '' }
      }}
      onDragStart={({ active }) => {
        setDrag({ id: String(active.id), over: undefined })
      }}
      // Unlike Twake Tasks' onDragOver: a place changes within one row.
      onDragMove={({ active, collisions }) => {
        dragTo(String(active.id), pointedAt(collisions, treeId))
      }}
      onDragEnd={({ active, collisions }) => {
        drop(String(active.id), pointedAt(collisions, treeId))
      }}
      onDragCancel={() => {
        setDrag(null)
      }}
    >
      <Root id={treeId} labelledBy={labelledBy} busy={moving !== null}>
        {branch(drawn, 1, null)}
      </Root>
      <DragOverlay>
        {dragged && (
          <Lifted
            level={dragged.level}
            parent={dragged.entry.children.length > 0}
            open={expanded.has(dragged.entry.id)}
            label={label(dragged.entry)}
          />
        )}
      </DragOverlay>
    </DndContext>
  )
}

/** The entries the arrows move through, in their order on screen. */
function shownOf<Entry extends TreeEntry<Entry>>(
  entries: Entry[],
  expanded: ReadonlySet<string>,
  parent: string | null = null,
  level = 1
): Shown<Entry>[] {
  return entries.flatMap(entry => [
    { entry, parent, level },
    ...(expanded.has(entry.id)
      ? shownOf(entry.children, expanded, entry.id, level + 1)
      : [])
  ])
}

// The list of the tree, measured by dnd-kit for the pointer beside it or
// below its last row.
function Root({
  id,
  labelledBy,
  busy,
  children
}: {
  id: string
  labelledBy: string
  busy: boolean
  children: ReactNode
}): ReactElement {
  const { setNodeRef } = useDroppable({ id })
  return (
    <Box
      component="ul"
      ref={setNodeRef}
      role="tree"
      aria-labelledby={labelledBy}
      aria-busy={busy}
      sx={LIST}
    >
      {children}
    </Box>
  )
}

const indentOf = (level: number) => 1 + (level - 1) * 2

const ROW_LABEL = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} as const

function Row({
  id,
  movable,
  level,
  current,
  highlighted,
  children
}: {
  id: string
  movable: boolean
  level: number
  current: boolean
  highlighted: boolean
  children: ReactNode
}): ReactElement {
  // The listeners alone, without the attributes that make a card of Twake
  // Tasks a button in the tab order: the item is the treeitem here, and the
  // tree one stop of the tab order.
  const { setNodeRef: setDragged, listeners } = useDraggable({
    id,
    disabled: !movable
  })
  const { setNodeRef: setDropped } = useDroppable({ id })
  const ref = useCallback(
    (node: HTMLElement | null) => {
      setDragged(node)
      setDropped(node)
    },
    [setDragged, setDropped]
  )
  const background = current ? 'action.selected' : 'transparent'
  return (
    <Box
      ref={ref}
      {...listeners}
      sx={theme => ({
        display: 'flex',
        alignItems: 'center',
        pl: indentOf(level),
        pr: 1,
        mx: 1,
        borderRadius: 1,
        bgcolor: highlighted
          ? theme.alpha(theme.vars.palette.primary.main, 0.08)
          : background,
        '&:hover': { bgcolor: current ? 'action.selected' : 'action.hover' },
        '& > a': {
          ...ROW_LABEL,
          py: 0.75,
          color: 'text.primary',
          fontWeight: current ? 600 : 400,
          textDecoration: 'none',
          borderRadius: 1,
          '&:focus-visible': {
            outline: `2px solid ${theme.vars.palette.primary.main}`
          },
          // A long press picks the entry up, where iOS would open the preview
          // of its link.
          ...(listeners && { WebkitTouchCallout: 'none' })
        }
      })}
    >
      {children}
    </Box>
  )
}

// As Twake Tasks dims the place a card leaves.
const DIMMED = { opacity: 0.4 } as const

function DropLine({
  level,
  component = 'div'
}: {
  level: number
  component?: 'div' | 'li'
}): ReactElement {
  return (
    <Box
      component={component}
      role={component === 'li' ? 'none' : undefined}
      aria-hidden
      sx={theme => ({
        position: 'relative',
        height: 0,
        '&::before': {
          content: '""',
          position: 'absolute',
          top: -1,
          left: theme.spacing(1 + indentOf(level)),
          right: theme.spacing(1),
          height: 2,
          borderRadius: 1,
          bgcolor: 'primary.main'
        }
      })}
    />
  )
}

// As Twake Tasks lifts a card.
function Lifted({
  level,
  parent,
  open,
  label
}: {
  level: number
  parent: boolean
  open: boolean
  label: string
}): ReactElement {
  return (
    <Box
      aria-hidden
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: '100%',
        pl: indentOf(level),
        pr: 1,
        borderRadius: 1,
        bgcolor: 'background.paper',
        boxShadow: 8,
        rotate: '2deg',
        cursor: 'grabbing'
      }}
    >
      <Chevron shown={parent} open={open} />
      <Box component="span" sx={ROW_LABEL}>
        {label}
      </Box>
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
  onToggle?: () => void
}): ReactElement {
  return (
    <Box
      component="span"
      aria-hidden
      onClick={shown ? onToggle : undefined}
      sx={{
        ...ROW_ICON,
        mr: 0.5,
        cursor: shown && onToggle ? 'pointer' : 'inherit',
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
