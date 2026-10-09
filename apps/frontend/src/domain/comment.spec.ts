import { describe, expect, it } from 'vitest'

import { commentParts, mentionsIn } from '@/domain/comment'

const JEAN = 'jean_dupont@example.com'

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

  // As the backend reads a mention, so that a comment shows as mentions the
  // members it made follow the page, and only them.
  it.each([
    ['after a space, before a comma', `Thanks @${JEAN}, it is done.`, JEAN],
    [
      'at the start, in another case',
      `@${JEAN.toUpperCase()} ok?`,
      JEAN.toUpperCase()
    ],
    ['before a full stop', `Ask @${JEAN}.`, JEAN],
    ['in brackets', `Done (@${JEAN})`, JEAN],
    ['in quotes', `"@${JEAN}" said so`, JEAN],
    [
      'with a percent sign',
      'Ask @jean%dupont@example.com',
      'jean%dupont@example.com'
    ],
    ['with a domain of one word', 'Ask @jean@localhost', 'jean@localhost']
  ])('reads a mention %s', (_case, body, email) => {
    expect(commentParts(body)).toContainEqual({ mention: email })
  })

  it.each([
    ['without its @', `write to ${JEAN}`],
    ['inside another address', `write to bob@${JEAN}`]
  ])('mentions no one in an email written %s', (_case, body) => {
    expect(commentParts(body)).toEqual([{ text: body }])
  })
})

describe('mentionsIn', () => {
  it('lists each email mentioned once, in lower case', () => {
    expect(
      mentionsIn('@Bob@Example.com, @carol@example.com and @bob@example.com')
    ).toEqual(['bob@example.com', 'carol@example.com'])
  })
})
