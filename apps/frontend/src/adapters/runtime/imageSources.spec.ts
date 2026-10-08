import { describe, expect, it } from 'vitest'

import { readImageSources } from '@/adapters/runtime/imageSources'

const SELF = 'https://pages.example.com'

describe('readImageSources', () => {
  it('takes the sources the runtime writes apart, by the spaces between them', () => {
    expect(
      readImageSources(
        { CSP_IMG_SRC: " https://avatars.example.com\t'self'  *.example.org " },
        SELF
      )
    ).toEqual({
      self: SELF,
      added: ['https://avatars.example.com', "'self'", '*.example.org']
    })
  })

  it.each([
    ['writes none', {}],
    ['writes an empty list', { CSP_IMG_SRC: '' }]
  ])('adds no source when the runtime %s', (_case, settings) => {
    expect(readImageSources(settings, SELF)).toEqual({ self: SELF, added: [] })
  })
})
