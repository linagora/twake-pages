import { generateKeyBetween } from 'fractional-indexing'
import { Refused } from './refusals.ts'

/**
 * A fractional key among `siblings`, in their order: right after `afterId`,
 * right before `beforeId`, or last without either. The neighbours come from
 * what the client saw: when they no longer sit next to each other, the tree
 * changed underneath, and the client reloads and retries.
 */
export function positionBetween(
  siblings: { id: string; position: string }[],
  afterId: string | undefined,
  beforeId: string | undefined
): string {
  const after = afterId ? siblings.findIndex(page => page.id === afterId) : -1
  const before = beforeId
    ? siblings.findIndex(page => page.id === beforeId)
    : -1
  if ((afterId && after < 0) || (beforeId && before < 0)) {
    throw new Refused('stale_neighbours')
  }
  if (afterId && beforeId && before !== after + 1) {
    throw new Refused('stale_neighbours')
  }
  const lower = afterId
    ? siblings[after]
    : beforeId
      ? siblings[before - 1]
      : siblings.at(-1)
  const upper = afterId
    ? siblings[after + 1]
    : beforeId
      ? siblings[before]
      : null
  return generateKeyBetween(lower?.position ?? null, upper?.position ?? null)
}
