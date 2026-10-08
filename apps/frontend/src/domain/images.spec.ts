import { describe, expect, it } from 'vitest'

import { imageHostsNotShown } from '@/domain/images'
import type { Block } from '@/domain/page'

const SELF = 'https://pages.example.com'

const image = (url: string, children: Block[] = []): Block => ({
  type: 'image',
  props: { url },
  children
})

/** The hosts of the images at `urls` that the `added` sources keep hidden. */
const notShown = (added: string[], ...urls: string[]) =>
  imageHostsNotShown(
    urls.map(url => image(url)),
    { self: SELF, added }
  )

describe('imageHostsNotShown', () => {
  it('names the hosts of the images that no source shows, once each', () => {
    expect(
      notShown(
        ['https://images.example.com'],
        'https://images.example.com/badge.png',
        'https://elsewhere.example.org/badge.png',
        'https://elsewhere.example.org/laptop.png'
      )
    ).toEqual(['elsewhere.example.org'])
  })

  it('looks into the blocks under others', () => {
    const item: Block = {
      type: 'bulletListItem',
      props: {},
      children: [image('https://elsewhere.example.org/badge.png')]
    }

    expect(imageHostsNotShown([item], { self: SELF, added: [] })).toEqual([
      'elsewhere.example.org'
    ])
  })

  it('shows the images of the app itself', () => {
    expect(notShown([], `${SELF}/badge.png`)).toEqual([])
  })

  it('names no host for an image still without an address', () => {
    expect(notShown([], '')).toEqual([])
  })

  it('names no host for an image that has none, as a data: one', () => {
    expect(notShown([], 'data:image/png;base64,iVBORw0KGgo=')).toEqual([])
  })

  it.each([
    ['a host', ['images.example.com'], 'https://images.example.com/a.png'],
    [
      'a host and its scheme, in any case',
      ['https://Images.Example.com'],
      'https://images.example.com/a.png'
    ],
    [
      'the hosts below a domain',
      ['https://*.example.com'],
      'https://cdn.images.example.com/a.png'
    ],
    ['a scheme', ['https:'], 'https://elsewhere.example.org/a.png'],
    ['any host', ['*'], 'https://elsewhere.example.org/a.png'],
    [
      'a port',
      ['https://images.example.com:8443'],
      'https://images.example.com:8443/a.png'
    ],
    [
      'any port',
      ['https://images.example.com:*'],
      'https://images.example.com:8443/a.png'
    ],
    [
      'a folder',
      ['https://images.example.com/team/'],
      'https://images.example.com/team/a.png'
    ],
    [
      'a file',
      ['https://images.example.com/team/a.png'],
      'https://images.example.com/team/a.png'
    ],
    [
      'one of several sources',
      ["'self'", 'https://avatars.example.com', 'images.example.com'],
      'https://images.example.com/a.png'
    ]
  ])('shows an image allowed by %s', (_case, added, url) => {
    expect(notShown(added, url)).toEqual([])
  })

  it.each([
    [
      'another host',
      ['https://images.example.com'],
      'https://elsewhere.example.org/a.png',
      'elsewhere.example.org'
    ],
    [
      'the hosts below a domain, for the domain',
      ['https://*.example.com'],
      'https://example.com/a.png',
      'example.com'
    ],
    [
      'a host on its default port',
      ['https://images.example.com'],
      'https://images.example.com:8443/a.png',
      'images.example.com:8443'
    ],
    [
      'another folder',
      ['https://images.example.com/team/'],
      'https://images.example.com/other/a.png',
      'images.example.com'
    ],
    [
      'another file',
      ['https://images.example.com/team/a.png'],
      'https://images.example.com/team/b.png',
      'images.example.com'
    ],
    [
      'another scheme',
      ['data:'],
      'https://images.example.com/a.png',
      'images.example.com'
    ],
    [
      'a keyword',
      ["'none'"],
      'https://images.example.com/a.png',
      'images.example.com'
    ]
  ])('does not show an image refused by %s', (_case, added, url, host) => {
    expect(notShown(added, url)).toEqual([host])
  })
})
