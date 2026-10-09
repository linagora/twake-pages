import { describe, expect, it } from 'vitest'

import { readGristOrigins } from '@/adapters/runtime/gristOrigins'

describe('readGristOrigins', () => {
  it('takes the origins the runtime writes apart, by the spaces between them', () => {
    expect(
      readGristOrigins({
        GRIST_URL: ' https://grist.example.com\thttp://localhost:3504/  '
      })
    ).toEqual(['https://grist.example.com', 'http://localhost:3504'])
  })

  it('reads an origin as the backend does', () => {
    expect(
      readGristOrigins({ GRIST_URL: 'HTTPS://Grist.Example.com:443' })
    ).toEqual(['https://grist.example.com'])
  })

  it.each([
    ['a path', 'https://grist.example.com/o/docs'],
    ['a query', 'https://grist.example.com/?embed=true'],
    ['a fragment', 'https://grist.example.com/#top'],
    ['a user name', 'https://admin@grist.example.com'],
    ['a password', 'https://:secret@grist.example.com'],
    ['another scheme', 'ftp://grist.example.com'],
    ['no scheme', 'grist.example.com']
  ])(
    'leaves out an origin with %s, on which the backend does not start',
    (_case, value) => {
      expect(
        readGristOrigins({ GRIST_URL: `${value} https://grist.example.com` })
      ).toEqual(['https://grist.example.com'])
    }
  )

  it.each([
    ['writes none', {}],
    ['writes an empty list', { GRIST_URL: '' }]
  ])('takes no origin when the runtime %s', (_case, settings) => {
    expect(readGristOrigins(settings)).toEqual([])
  })
})
