import { describe, expect, it } from 'vitest'
import { positionBetween } from './order.ts'

const siblings = [
  { id: 'intro', position: 'a0' },
  { id: 'setup', position: 'a1' },
  { id: 'usage', position: 'a2' }
]

describe('positionBetween', () => {
  it('starts the order of a parent without children', () => {
    expect(positionBetween([], undefined, undefined)).toBe('a0')
  })

  it('places a page last when no neighbour is given', () => {
    expect(positionBetween(siblings, undefined, undefined)).toBe('a3')
  })

  it('places a page right after the given sibling', () => {
    const position = positionBetween(siblings, 'intro', undefined)

    expect(position > 'a0' && position < 'a1').toBe(true)
  })

  it('places a page right before the given sibling', () => {
    const position = positionBetween(siblings, undefined, 'intro')

    expect(position < 'a0').toBe(true)
  })

  it('places a page between the two given siblings', () => {
    const position = positionBetween(siblings, 'setup', 'usage')

    expect(position > 'a1' && position < 'a2').toBe(true)
  })

  it.each([
    ['a page that is no sibling', 'elsewhere', undefined],
    ['siblings in the wrong order', 'usage', 'setup'],
    ['siblings that are not next to each other', 'intro', 'usage']
  ])('refuses %s', (_case, afterId, beforeId) => {
    expect(() => positionBetween(siblings, afterId, beforeId)).toThrow(
      'stale_neighbours'
    )
  })
})
