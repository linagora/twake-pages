import { describe, expect, it } from 'vitest'

import { displayName, sameEmail } from '@/domain/person'

describe('displayName', () => {
  it('shows the name', () => {
    expect(displayName({ email: 'ana@example.com', name: ' Ana Lopez ' })).toBe(
      'Ana Lopez'
    )
  })

  it.each([null, '', '  '])('falls back to the email for %j', name => {
    expect(displayName({ email: 'ana@example.com', name })).toBe(
      'ana@example.com'
    )
  })
})

describe('sameEmail', () => {
  it('takes an email in any case for itself', () => {
    expect(sameEmail('Ana@Example.com', 'ana@example.COM')).toBe(true)
  })

  it.each(['bob@example.com', null])('tells it apart from %j', other => {
    expect(sameEmail('ana@example.com', other)).toBe(false)
  })
})
