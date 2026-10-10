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
