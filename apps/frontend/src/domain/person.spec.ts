import { describe, expect, it } from 'vitest'

import { displayName } from '@/domain/person'

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
