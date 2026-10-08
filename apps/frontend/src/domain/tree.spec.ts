import { describe, expect, it } from 'vitest'

import type { TreePage } from '@/domain/page'
import { ancestorsOf, buildTree } from '@/domain/tree'

const page = (
  id: string,
  parentId: string | null,
  position: string
): TreePage => ({ id, parentId, position, title: id, kind: 'document' })

describe('buildTree', () => {
  it('nests each page under its parent', () => {
    const tree = buildTree([
      page('laptop', 'onboarding', 'a0'),
      page('onboarding', null, 'a0'),
      page('accounts', 'onboarding', 'a1'),
      page('faq', null, 'a1')
    ])

    expect(tree).toMatchObject([
      {
        id: 'onboarding',
        children: [
          { id: 'laptop', children: [] },
          { id: 'accounts', children: [] }
        ]
      },
      { id: 'faq', children: [] }
    ])
  })

  it('orders siblings by position, compared as plain strings', () => {
    const tree = buildTree([
      page('b', null, 'a1'),
      page('c', null, 'a0V'),
      page('a', null, 'Zz'),
      page('d', null, 'a0')
    ])

    expect(tree.map(node => node.id)).toEqual(['a', 'd', 'c', 'b'])
  })
})

describe('ancestorsOf', () => {
  const pages = [
    page('setup', 'laptop', 'a0'),
    page('onboarding', null, 'a0'),
    page('laptop', 'onboarding', 'a0'),
    page('faq', null, 'a1')
  ]

  it('lists the pages above a page, from the top down to its parent', () => {
    expect(ancestorsOf(pages, 'setup').map(ancestor => ancestor.id)).toEqual([
      'onboarding',
      'laptop'
    ])
  })

  it.each(['faq', 'unknown'])('has none for %s', pageId => {
    expect(ancestorsOf(pages, pageId)).toEqual([])
  })
})
