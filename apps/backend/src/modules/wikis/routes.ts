import type { HttpServer } from '../../infra/http.ts'
import type { RequireIdentity } from '../auth/index.ts'

export interface WikiSummary {
  id: string
  name: string
}

// No wiki is kept yet, so everyone has none.
export function registerWikis(
  app: HttpServer,
  deps: { requireIdentity: RequireIdentity }
): void {
  app.get(
    '/wikis',
    { preHandler: deps.requireIdentity },
    (): WikiSummary[] => []
  )
}
