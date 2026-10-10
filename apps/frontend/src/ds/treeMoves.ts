import type { ClientRect, Collision, CollisionDetection } from '@dnd-kit/core'

// Unlike Twake Tasks, which keeps its drag maths in application/boardDrag.ts
// for a board drawn in ui/, the maths of a move in the tree stay in ds/: the
// tree is a ds/ component, generic over its entries, and ds/ imports no other
// layer.

export interface TreeEntry<Entry> {
  id: string
  children: Entry[]
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

/** A row, and how far down it the pointer is: 0 at its top, 1 at its bottom. */
export interface PointerOnRow {
  id: string
  height: number
}

/** The row under the pointer, or null below the last row. */
export type Pointed = PointerOnRow | null

export function whereIs<Entry extends TreeEntry<Entry>>(
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

export function entryAt<Entry>(
  place: TreePlace<Entry> | undefined
): Entry | undefined {
  return place?.siblings[place.index]
}

export function samePlace<Entry extends TreeEntry<Entry>>(
  one: TreePlace<Entry> | undefined,
  other: TreePlace<Entry> | undefined
): boolean {
  return (
    one === other ||
    (one !== undefined &&
      other !== undefined &&
      (one.parent?.id ?? null) === (other.parent?.id ?? null) &&
      one.index === other.index)
  )
}

/** Where Alt+Shift and the arrow `key` move the entry at `at`, if it can go. */
export function placeFor<Entry extends TreeEntry<Entry>>(
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

/**
 * The row under the pointer, with how far down it the pointer is, else the
 * tree itself, for the space below its last row, as tall as a row. Beside
 * the tree, nothing. Unlike Twake Tasks, which places a card by its copy
 * against the card under it, the pointer places an entry: a row stands for
 * three places, before it, under it and after it.
 */
export const rowUnderPointer =
  (treeId: string) =>
  ({
    droppableRects,
    pointerCoordinates
  }: Pick<
    Parameters<CollisionDetection>[0],
    'droppableRects' | 'pointerCoordinates'
  >): Collision[] => {
    const tree = droppableRects.get(treeId)
    if (!pointerCoordinates || !tree) return []
    const { x, y } = pointerCoordinates
    if (x < tree.left || x > tree.right) return []
    let last: ClientRect | undefined
    for (const [id, rect] of droppableRects) {
      if (id === treeId) continue
      if (y >= rect.top && y < rect.bottom) {
        return [{ id, data: { height: (y - rect.top) / rect.height } }]
      }
      if (!last || rect.bottom > last.bottom) last = rect
    }
    return last && y >= last.bottom && y < last.bottom + last.height
      ? [{ id: treeId }]
      : []
  }

export function pointedAt(
  collisions: Collision[] | null,
  treeId: string
): Pointed | undefined {
  const [first] = collisions ?? []
  if (!first) return undefined
  if (first.id === treeId) return null
  const height: unknown = first.data?.height
  return typeof height === 'number'
    ? { id: String(first.id), height }
    : undefined
}

export function placeForDrop<Entry extends TreeEntry<Entry>>(
  entries: Entry[],
  expanded: ReadonlySet<string>,
  id: string,
  over: Pointed
): TreePlace<Entry> | undefined {
  const from = whereIs(entries, id)
  const dragged = entryAt(from)
  if (!dragged) return undefined
  // An entry goes neither under itself nor under an entry under it.
  if (over && (over.id === id || whereIs(dragged.children, over.id))) {
    return undefined
  }
  const to = over
    ? placeOnRow(entries, expanded, id, over)
    : lastPlaceAtTop(entries, id)
  return samePlace(to, from) ? undefined : to
}

function lastPlaceAtTop<Entry extends TreeEntry<Entry>>(
  entries: Entry[],
  id: string
): TreePlace<Entry> {
  const siblings = entries.filter(entry => entry.id !== id)
  return { parent: null, siblings, index: siblings.length }
}

function placeOnRow<Entry extends TreeEntry<Entry>>(
  entries: Entry[],
  expanded: ReadonlySet<string>,
  id: string,
  over: PointerOnRow
): TreePlace<Entry> | undefined {
  const at = whereIs(entries, over.id)
  const row = entryAt(at)
  if (!at || !row) return undefined
  const others = (siblings: Entry[]) =>
    siblings.filter(entry => entry.id !== id)
  const top = over.height < 1 / 4
  const bottom = over.height > 3 / 4
  const open = row.children.length > 0 && expanded.has(row.id)
  if (top || (bottom && !open)) {
    const siblings = others(at.siblings)
    const index = siblings.indexOf(row) + (bottom ? 1 : 0)
    return { parent: at.parent, siblings, index }
  }
  // Below a row whose entries show comes the first of them: the entry goes
  // before it, as from the top quarter of its row.
  const siblings = others(row.children)
  return { parent: row, siblings, index: bottom ? 0 : siblings.length }
}

/** `entries` as a drop shows them: the entry `id` lifted out, put at `to`. */
export function withDrop<Entry extends TreeEntry<Entry>>(
  entries: Entry[],
  id: string,
  to: TreePlace<Entry>
): Entry[] {
  const entry = entryAt(whereIs(entries, id))
  const parent = to.parent?.id ?? null
  const without = (siblings: Entry[]): Entry[] =>
    siblings
      .filter(each => each.id !== id)
      .map(each => ({ ...each, children: without(each.children) }))
  const lifted = without(entries)
  // Gone meanwhile, the new parent leaves the entries as they are.
  if (!entry || (parent !== null && !whereIs(lifted, parent))) return entries
  const into = (siblings: Entry[], under: string | null): Entry[] =>
    under === parent
      ? siblings.toSpliced(to.index, 0, entry)
      : siblings.map(each => ({
          ...each,
          children: into(each.children, each.id)
        }))
  return into(lifted, null)
}
