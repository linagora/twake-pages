import type { ImageSources } from '@/domain/images'

/**
 * Where the app at `self` shows images from: the runtime writes the sources
 * its Content Security Policy adds in /.env.js, apart by spaces, as an
 * operator writes them in CSP_IMG_SRC.
 */
export function readImageSources(
  settings: Pick<Window, 'CSP_IMG_SRC'>,
  self: string
): ImageSources {
  return {
    self,
    added: (settings.CSP_IMG_SRC ?? '').split(/\s+/).filter(Boolean)
  }
}
