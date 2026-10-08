import { createHash } from 'node:crypto'
import type { Identity, IdentityProvider } from './oidc.ts'
import type { AuthStore } from './store.ts'

export type Authenticate = (accessToken: string) => Promise<Identity | null>

const CACHE_TTL_MS = 60_000

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

export function createAuthenticator(deps: {
  provider: IdentityProvider
  store: AuthStore
  now?: () => number
}): Authenticate {
  const now = deps.now ?? Date.now
  const cache = new Map<string, { identity: Identity; until: number }>()

  function evictExpired(at: number) {
    for (const [key, entry] of cache) {
      if (entry.until > at) break
      cache.delete(key)
    }
  }

  return async accessToken => {
    const key = sha256(accessToken)
    const at = now()
    let entry = cache.get(key)
    if (!entry || entry.until <= at) {
      cache.delete(key)
      const identity = await deps.provider.identify(accessToken)
      if (!identity) return null
      evictExpired(at)
      entry = {
        identity,
        until: Math.min(identity.expiresAt.getTime(), at + CACHE_TTL_MS)
      }
      cache.set(key, entry)
    }
    if (await deps.store.isRevoked(entry.identity.sessionId)) return null
    return entry.identity
  }
}
