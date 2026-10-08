import type { Db } from '../../infra/db.ts'
import { createAuthenticator, type Authenticate } from './authenticator.ts'
import {
  discoverIdentityProvider,
  type IdentityProvider,
  type OidcOptions
} from './oidc.ts'
import { postgresAuthStore } from './store.ts'

export type { Authenticate } from './authenticator.ts'
export type { Identity, IdentityProvider } from './oidc.ts'
export type { RequireIdentity } from './routes.ts'
export { registerAuth } from './routes.ts'
export { postgresAuthStore } from './store.ts'

export async function connectIdentityProvider(deps: {
  db: Db
  oidc: OidcOptions
}): Promise<{ provider: IdentityProvider; authenticate: Authenticate }> {
  const provider = await discoverIdentityProvider(deps.oidc)
  const store = postgresAuthStore(deps.db)
  return { provider, authenticate: createAuthenticator({ provider, store }) }
}
