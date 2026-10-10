import { describe, expect, it } from 'vitest'

import {
  placeForDrop,
  pointedAt,
  rowUnderPointer,
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
