import { describe, expect, it } from 'vitest'

import en from '@/locales/en.json'
import fr from '@/locales/fr.json'

interface Dictionary {
  [key: string]: string | Dictionary
}

function keys(dictionary: Dictionary, prefix = ''): string[] {
  return Object.entries(dictionary).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [`${prefix}${key}`]
      : keys(value, `${prefix}${key}.`)
  )
}

describe('locales', () => {
  it('has the English keys in French, and no others', () => {
    expect(keys(fr).sort()).toEqual(keys(en).sort())
  })
})
