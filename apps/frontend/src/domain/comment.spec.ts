import { describe, expect, it } from 'vitest'

import { commentParts, mentionsIn } from '@/domain/comment'

describe('commentParts', () => {
  it('cuts a comment into text and the emails it mentions', () => {
    expect(
      commentParts('Thanks @bob@example.com, ask @Carol.Diaz@example.org.')
    ).toEqual([
      { text: 'Thanks ' },
      { mention: 'bob@example.com' },
      { text: ', ask ' },
      { mention: 'Carol.Diaz@example.org' },
      { text: '.' }
    ])
  })

  it.each(['write to bob@example.com', 'see x@bob@example.com'])(
    'mentions no one in %j',
    body => {
      expect(commentParts(body)).toEqual([{ text: body }])
    }
  )
})

describe('mentionsIn', () => {
  it('lists each email mentioned once, in lower case', () => {
    expect(
      mentionsIn('@Bob@Example.com, @carol@example.com and @bob@example.com')
    ).toEqual(['bob@example.com', 'carol@example.com'])
  })
})
