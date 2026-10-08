import { describe, expect, it } from 'vitest'

import { excerptParts } from '@/domain/search'

// The contract marks each word found between U+E000 and U+E001.
const found = (word: string) =>
  `${String.fromCharCode(0xe000)}${word}${String.fromCharCode(0xe001)}`

describe('excerptParts', () => {
  it('cuts an excerpt into plain text and the words found', () => {
    expect(
      excerptParts(`Bring your ${found('laptop')} on ${found('day')} one`)
    ).toEqual([
      { text: 'Bring your ', highlighted: false },
      { text: 'laptop', highlighted: true },
      { text: ' on ', highlighted: false },
      { text: 'day', highlighted: true },
      { text: ' one', highlighted: false }
    ])
  })

  it('leaves out empty text around the words found', () => {
    expect(excerptParts(`${found('Laptop')} ${found('setup')}`)).toEqual([
      { text: 'Laptop', highlighted: true },
      { text: ' ', highlighted: false },
      { text: 'setup', highlighted: true }
    ])
  })
})
