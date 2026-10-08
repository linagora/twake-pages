import { createContext, use, type ReactElement, type ReactNode } from 'react'

import type { PagesApi } from '@/application/pages'

const PagesApiContext = createContext<PagesApi | null>(null)

export function usePagesApi(): PagesApi {
  const api = use(PagesApiContext)
  if (!api) throw new Error('usePagesApi must be used inside PagesApiProvider')
  return api
}

export function PagesApiProvider({
  api,
  children
}: {
  api: PagesApi
  children: ReactNode
}): ReactElement {
  return <PagesApiContext value={api}>{children}</PagesApiContext>
}
