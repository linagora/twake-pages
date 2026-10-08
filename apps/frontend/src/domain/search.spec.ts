import { describe, expect, it } from 'vitest'

import { excerptParts, FOUND_END, FOUND_START } from '@/domain/search'

const found = (word: string) => `${FOUND_START}${word}${FOUND_END}`

describe('excerptParts', () => {
  it('cuts an excerpt into plain text and the words found', () => {
    expect(
      excerptParts('Bring your \uE000laptop\uE001 on \uE000day\uE001 one')
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
