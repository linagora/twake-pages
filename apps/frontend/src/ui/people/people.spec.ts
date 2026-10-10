import { describe, expect, it } from 'vitest'

import type { Person } from '@/domain/person'
import { matchingPeople, matchScore } from '@/ui/people/people'

const jean: Person = {
  id: 'u-jean',
  email: 'jean_dupont@example.com',
  name: null
}
const alice: Person = {
  id: 'u-alice',
  email: 'alice@example.com',
  name: 'Alice Martin'
}
const albert: Person = {
  id: 'u-albert',
  email: 'albert@example.com',
  name: 'Albert Roux'
}
const eloise: Person = {
  id: 'u-eloise',
  email: 'e.faure@example.com',
  name: 'Éloïse Faure'
}

describe('matchScore', () => {
  it('splits the query like the words of the person', () => {
    expect(matchScore(jean, 'jean_du')).toBe(3)
    expect(matchScore(jean, 'jean.du')).toBe(3)
    expect(matchScore(jean, 'jean du')).toBe(3)
    expect(matchScore(alice, 'alice@ex')).toBe(3)
  })

  it('ranks the start of a word, then a part of one, then letters in order', () => {
    expect(matchScore(alice, 'mar')).toBe(3)
    expect(matchScore(alice, 'tin')).toBe(2)
    expect(matchScore(alice, 'amn')).toBe(1)
  })

  it('reads a name and a query without their accents or capitals', () => {
    expect(matchScore(eloise, 'ELOI')).toBe(3)
    expect(matchScore(alice, 'Alicé')).toBe(3)
  })

  it('still refuses what matches nothing', () => {
    expect(matchScore(jean, 'zzz')).toBe(0)
  })
})

describe('matchingPeople', () => {
  it('finds a person by an email with an underscore', () => {
    expect(matchingPeople([alice, jean], 'jean_du')).toEqual([jean])
  })

  it('puts the best match first, in the order given among equals', () => {
    expect(matchingPeople([jean, albert, alice], 'al')).toEqual([
      albert,
      alice,
      jean
    ])
  })

  it('gives everyone, as given, for an empty query', () => {
    expect(matchingPeople([jean, alice], '')).toEqual([jean, alice])
  })
})
