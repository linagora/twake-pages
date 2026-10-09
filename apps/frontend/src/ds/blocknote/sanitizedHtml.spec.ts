import { describe, expect, it } from 'vitest'

import { sanitizedHtml } from '@/ds/blocknote/sanitizedHtml'
import { BUDGET, GRIST_ORIGIN, OFF_GRIST_ORIGINS } from '@/testing/fakePagesApi'

/** The addresses of the frames `html` keeps, framing the Grist origin. */
const framesOf = (html: string) =>
  [...sanitizedHtml(html, [GRIST_ORIGIN]).querySelectorAll('iframe')].map(
    frame => frame.getAttribute('src')
  )

describe('the HTML of the blocks, sanitized', () => {
  it('keeps the frame of a document on a Grist origin', () => {
    expect(
      framesOf(`<iframe src="${BUDGET}" title="Grist document"></iframe>`)
    ).toEqual([BUDGET])
  })

  it.each([
    ...OFF_GRIST_ORIGINS,
    ['that runs a script', 'javascript:alert(1)'],
    ['that holds the page itself', 'data:text/html,<p>Budget</p>']
  ])('keeps no frame of an address %s', (_case, address) => {
    expect(framesOf(`<iframe src="${address}"></iframe>`)).toEqual([])
  })

  it('keeps no frame without an address', () => {
    expect(framesOf('<iframe title="Grist document"></iframe>')).toEqual([])
  })

  it('keeps no page written in a frame, which it shows in place of its address', () => {
    const frames = sanitizedHtml(
      `<iframe src="${BUDGET}" srcdoc="<script>alert(1)</script>"></iframe>`,
      [GRIST_ORIGIN]
    ).querySelectorAll('iframe')

    expect([...frames].map(frame => frame.hasAttribute('srcdoc'))).toEqual([
      false
    ])
  })

  it.each([
    ['an embed', `<embed src="${BUDGET}">`],
    ['an object', `<object data="${BUDGET}"></object>`]
  ])('keeps no %s, though on a Grist origin', (_case, html) => {
    expect(
      sanitizedHtml(html, [GRIST_ORIGIN]).querySelector('embed, object')
    ).toBeNull()
  })

  it('keeps no frame when the pages frame no Grist', () => {
    expect(
      sanitizedHtml(`<iframe src="${BUDGET}"></iframe>`, []).querySelector(
        'iframe'
      )
    ).toBeNull()
  })
})
