import { describe, expect, it } from 'vitest'

import {
  entryAt,
  placeFor,
  placeForDrop,
  pointedAt,
  rowUnderPointer,
  samePlace,
  whereIs,
  withDrop
} from '@/ds/treeMoves'

interface Entry {
  id: string
  children: Entry[]
}

const entry = (id: string, ...children: Entry[]): Entry => ({ id, children })

const laptop = entry('laptop')
const firstWeek = entry('first-week')
const onboarding = entry('onboarding', laptop, firstWeek)
const checklist = entry('checklist')
const releases = entry('releases', checklist)
const entries = [onboarding, releases]
// Onboarding shows its child pages, Releases does not.
const expanded = new Set(['onboarding'])

describe('whereIs', () => {
  it("finds an entry's place among its siblings, and its parent", () => {
    expect(whereIs(entries, 'onboarding')).toEqual({
      parent: null,
      siblings: entries,
      index: 0
    })
    expect(whereIs(entries, 'releases')).toEqual({
      parent: null,
      siblings: entries,
      index: 1
    })
    expect(whereIs(entries, 'first-week')).toEqual({
      parent: onboarding,
      siblings: [laptop, firstWeek],
      index: 1
    })
  })

  it('finds nothing for an entry the tree does not hold', () => {
    expect(whereIs(entries, 'gone')).toBeUndefined()
    expect(whereIs([], 'onboarding')).toBeUndefined()
  })
})

describe('entryAt', () => {
  it('reads the entry a place holds', () => {
    expect(entryAt(whereIs(entries, 'onboarding'))).toBe(onboarding)
    expect(entryAt(whereIs(entries, 'laptop'))).toBe(laptop)
  })

  it('reads nothing where there is no place, or no entry there', () => {
    expect(entryAt(undefined)).toBeUndefined()
    expect(entryAt(whereIs(entries, 'gone'))).toBeUndefined()
  })
})

/** The place of an entry the fixture holds, which every case names. */
const placeOf = (id: string) => {
  const place = whereIs(entries, id)
  if (!place) throw new Error(`no place for ${id}`)
  return place
}

describe('placeFor', () => {
  it('moves the entry up and down among its siblings', () => {
    expect(placeFor(entries, placeOf('releases'), 'ArrowUp')).toEqual({
      parent: null,
      siblings: [onboarding],
      index: 0
    })
    expect(placeFor(entries, placeOf('laptop'), 'ArrowDown')).toEqual({
      parent: onboarding,
      siblings: [firstWeek],
      index: 1
    })
  })

  it('moves the entry nowhere past the first or the last of its siblings', () => {
    expect(placeFor(entries, placeOf('laptop'), 'ArrowUp')).toBeUndefined()
    expect(placeFor(entries, placeOf('releases'), 'ArrowDown')).toBeUndefined()
    expect(
      placeFor(entries, placeOf('first-week'), 'ArrowDown')
    ).toBeUndefined()
  })

  it('moves the entry under the sibling before it, last among its entries', () => {
    expect(placeFor(entries, placeOf('releases'), 'ArrowRight')).toEqual({
      parent: onboarding,
      siblings: [laptop, firstWeek],
      index: 2
    })
    expect(placeFor(entries, placeOf('first-week'), 'ArrowRight')).toEqual({
      parent: laptop,
      siblings: [],
      index: 0
    })
  })

  it('moves the entry under nothing when no sibling precedes it', () => {
    expect(
      placeFor(entries, placeOf('onboarding'), 'ArrowRight')
    ).toBeUndefined()
    expect(placeFor(entries, placeOf('laptop'), 'ArrowRight')).toBeUndefined()
  })

  it("moves the entry out to the parent's level, right after the parent", () => {
    expect(placeFor(entries, placeOf('laptop'), 'ArrowLeft')).toEqual({
      parent: null,
      siblings: entries,
      index: 1
    })
    expect(placeFor(entries, placeOf('first-week'), 'ArrowLeft')).toEqual({
      parent: null,
      siblings: entries,
      index: 1
    })
  })

  it('moves the entry out of nothing at the top of the tree', () => {
    expect(placeFor(entries, placeOf('releases'), 'ArrowLeft')).toBeUndefined()
  })
})

describe('samePlace', () => {
  it('holds for two places of the same parent and index', () => {
    expect(
      samePlace(whereIs(entries, 'laptop'), whereIs(entries, 'laptop'))
    ).toBe(true)
    expect(samePlace(undefined, undefined)).toBe(true)
    expect(samePlace(whereIs(entries, 'gone'), whereIs(entries, 'gone'))).toBe(
      true
    )
  })

  it('tells apart places of another index, another parent, or none', () => {
    expect(
      samePlace(whereIs(entries, 'laptop'), whereIs(entries, 'first-week'))
    ).toBe(false)
    expect(
      samePlace(whereIs(entries, 'laptop'), whereIs(entries, 'releases'))
    ).toBe(false)
    expect(samePlace(whereIs(entries, 'laptop'), undefined)).toBe(false)
    expect(samePlace(undefined, whereIs(entries, 'laptop'))).toBe(false)
  })
})

describe('placeForDrop', () => {
  it('puts the entry before the row whose top quarter it is dropped on', () => {
    expect(
      placeForDrop(entries, expanded, 'first-week', {
        id: 'laptop',
        height: 0.2
      })
    ).toEqual({ parent: onboarding, siblings: [laptop], index: 0 })
  })

  it('puts the entry after the row whose bottom quarter it is dropped on', () => {
    expect(
      placeForDrop(entries, expanded, 'laptop', {
        id: 'first-week',
        height: 0.8
      })
    ).toEqual({ parent: onboarding, siblings: [firstWeek], index: 1 })
  })

  it('puts the entry last under the row whose middle it is dropped on', () => {
    expect(
      placeForDrop(entries, expanded, 'laptop', { id: 'releases', height: 0.5 })
    ).toEqual({ parent: releases, siblings: [checklist], index: 1 })
  })

  it('puts the entry first under an expanded row whose bottom quarter it is dropped on', () => {
    expect(
      placeForDrop(entries, expanded, 'releases', {
        id: 'onboarding',
        height: 0.8
      })
    ).toEqual({ parent: onboarding, siblings: [laptop, firstWeek], index: 0 })
  })

  it('takes the entry out to the top of the tree, last below the last row', () => {
    expect(
      placeForDrop(entries, expanded, 'laptop', { id: 'releases', height: 0.2 })
    ).toEqual({ parent: null, siblings: [onboarding, releases], index: 1 })
    expect(placeForDrop(entries, expanded, 'laptop', null)).toEqual({
      parent: null,
      siblings: [onboarding, releases],
      index: 2
    })
  })

  it('lands nowhere when the entry ends where it is', () => {
    expect(
      placeForDrop(entries, expanded, 'laptop', {
        id: 'first-week',
        height: 0.2
      })
    ).toBeUndefined()
    expect(
      placeForDrop(entries, expanded, 'first-week', {
        id: 'laptop',
        height: 0.8
      })
    ).toBeUndefined()
    expect(
      placeForDrop(entries, expanded, 'laptop', {
        id: 'onboarding',
        height: 0.8
      })
    ).toBeUndefined()
    expect(placeForDrop(entries, expanded, 'releases', null)).toBeUndefined()
  })

  it('lands nowhere on the entry itself or under it', () => {
    expect(
      placeForDrop(entries, expanded, 'onboarding', {
        id: 'onboarding',
        height: 0.5
      })
    ).toBeUndefined()
    expect(
      placeForDrop(entries, expanded, 'onboarding', {
        id: 'laptop',
        height: 0.5
      })
    ).toBeUndefined()
    expect(
      placeForDrop(entries, expanded, 'onboarding', {
        id: 'first-week',
        height: 0.9
      })
    ).toBeUndefined()
  })
})

describe('rowUnderPointer', () => {
  const TREE = 'tree'
  const rect = (top: number, height: number) => ({
    top,
    bottom: top + height,
    left: 0,
    right: 240,
    width: 240,
    height
  })
  const droppableRects = new Map([
    [TREE, rect(0, 64)],
    ['onboarding', rect(0, 32)],
    ['releases', rect(32, 32)]
  ])
  const underPointerAt = (x: number, y: number) =>
    pointedAt(
      rowUnderPointer(TREE)({ droppableRects, pointerCoordinates: { x, y } }),
      TREE
    )

  it('finds the row under the pointer, and how far down it', () => {
    expect(underPointerAt(20, 0)).toEqual({ id: 'onboarding', height: 0 })
    expect(underPointerAt(20, 40)).toEqual({ id: 'releases', height: 0.25 })
  })

  it('finds the space below the last row, as tall as a row', () => {
    expect(underPointerAt(20, 64)).toBeNull()
    expect(underPointerAt(20, 95)).toBeNull()
  })

  it('finds nothing beside the tree, or further below it', () => {
    expect(underPointerAt(241, 40)).toBeUndefined()
    expect(underPointerAt(-1, 40)).toBeUndefined()
    expect(underPointerAt(20, 96)).toBeUndefined()
  })
})

describe('withDrop', () => {
  it('lifts the entry out, and puts it at its new place', () => {
    expect(
      withDrop(entries, 'laptop', {
        parent: releases,
        siblings: [checklist],
        index: 0
      })
    ).toEqual([
      entry('onboarding', firstWeek),
      entry('releases', laptop, checklist)
    ])
  })

  it('leaves the entries as they are once the new parent is gone', () => {
    expect(
      withDrop(entries, 'laptop', {
        parent: entry('gone'),
        siblings: [],
        index: 0
      })
    ).toBe(entries)
  })

  it('leaves the entries as they are once the entry is gone', () => {
    expect(
      withDrop(entries, 'gone', { parent: null, siblings: entries, index: 0 })
    ).toBe(entries)
  })
})
