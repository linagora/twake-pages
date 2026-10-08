import type { Move } from '@/application/pages'

/**
 * The move to `index` among the pages under `parentId`, as Twake Tasks moves
 * a task into a section: `ids` leave the moved page out.
 */
export function moveInto(
  parentId: string | null,
  ids: string[],
  index: number
): Move {
  const afterId = ids[index - 1]
  const beforeId = ids[index]
  return {
    parentId,
    ...(afterId !== undefined && { afterId }),
    ...(beforeId !== undefined && { beforeId })
  }
}
