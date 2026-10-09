import { createContext, use, type ReactElement, type ReactNode } from 'react'

const GristOriginsContext = createContext<readonly string[] | null>(null)

/** The origins of Grist the pages frame documents from, which the deployment tells. */
export function useGristOrigins(): readonly string[] {
  const origins = use(GristOriginsContext)
  if (!origins) {
    throw new Error('useGristOrigins must be used inside GristOriginsProvider')
  }
  return origins
}

export function GristOriginsProvider({
  origins,
  children
}: {
  origins: readonly string[]
  children: ReactNode
}): ReactElement {
  return <GristOriginsContext value={origins}>{children}</GristOriginsContext>
}
