import DOMPurify from 'dompurify'

import { onGristOrigin } from '@/ds/grist'

/**
 * `html` of blocks that others write, as it shows read only: without what
 * could run a script, and with no frame but that of a document of Grist on
 * one of `gristOrigins`, as the Grist embed draws it.
 */
export function sanitizedHtml(
  html: string,
  gristOrigins: readonly string[]
): DocumentFragment {
  // An instance of its own, as its hook holds the origins of this call.
  const purify = DOMPurify(window)
  purify.addHook('uponSanitizeElement', (node, { tagName }) => {
    if (tagName !== 'iframe' || !(node instanceof Element)) return
    const address = node.getAttribute('src')
    if (address === null || !onGristOrigin(address, gristOrigins)) {
      node.remove()
    }
  })
  return purify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    // A link opens in a new tab, as from the editor.
    ADD_ATTR: ['target'],
    // A frame shows its address, never a page written in it.
    FORBID_ATTR: ['srcdoc'],
    RETURN_DOM_FRAGMENT: true
  })
}
