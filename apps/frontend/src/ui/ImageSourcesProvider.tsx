import { createContext, use, type ReactElement, type ReactNode } from 'react'

import type { ImageSources } from '@/domain/images'

const ImageSourcesContext = createContext<ImageSources | null>(null)

/** Where the app shows images from, which the deployment tells. */
export function useImageSources(): ImageSources {
  const sources = use(ImageSourcesContext)
  if (!sources) {
    throw new Error('useImageSources must be used inside ImageSourcesProvider')
  }
  return sources
}

export function ImageSourcesProvider({
  sources,
  children
}: {
  sources: ImageSources
  children: ReactNode
}): ReactElement {
  return <ImageSourcesContext value={sources}>{children}</ImageSourcesContext>
}
