import type { TreePage } from '@/domain/page'

export interface TreeNode extends TreePage {
  children: TreeNode[]
}

// Fractional keys sort by code unit, as the database's "C" collation does:
// localeCompare would put 'Zz' after 'a0'.
export const byPosition = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0

export function buildTree(pages: TreePage[]): TreeNode[] {
  const children = new Map<string | null, TreePage[]>()
  for (const page of pages.toSorted(byPosition)) {
    children.set(page.parentId, [...(children.get(page.parentId) ?? []), page])
  }
  const nodesUnder = (parentId: string | null): TreeNode[] =>
    (children.get(parentId) ?? []).map(page => ({
      ...page,
      children: nodesUnder(page.id)
    }))
  return nodesUnder(null)
}

export function ancestorsOf(pages: TreePage[], pageId: string): TreePage[] {
  const byId = new Map(pages.map(page => [page.id, page]))
  const ancestors: TreePage[] = []
  let parentId = byId.get(pageId)?.parentId ?? null
  while (parentId !== null) {
    const parent = byId.get(parentId)
    if (!parent) break
    ancestors.unshift(parent)
    parentId = parent.parentId
  }
  return ancestors
}
