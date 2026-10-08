import { pino } from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { createServer } from '../../infra/http.ts'
import type { Authenticate } from './authenticator.ts'
import type { IdentityProvider } from './oidc.ts'
import { registerAuth } from './routes.ts'
import type { AuthStore } from './store.ts'
import { anIdentity } from './testing.ts'

function setUp(
  authenticate: Authenticate = () => Promise.resolve(anIdentity())
) {
  const app = createServer({
    logger: pino({ level: 'silent' }),
    isReady: () => Promise.resolve(true)
  })
  const provider: IdentityProvider = {
    identify: vi.fn(),
    verifyLogoutToken: vi.fn((token: string) =>
      token === 'valid'
        ? Promise.resolve('session-1')
        : Promise.reject(new Error('invalid'))
    )
  }
  const store = {
    isRevoked: vi.fn(),
    revoke: vi.fn(() => Promise.resolve())
  } satisfies AuthStore
  const requireIdentity = registerAuth(app, { authenticate, provider, store })
  app.get('/whoami', { preHandler: requireIdentity }, request => ({
    email: request.identity?.email,
    organizationId: request.identity?.organizationId
  }))
  return { app, store }
}

describe('requireIdentity', () => {
  it('asks for a bearer token', async () => {
    const { app } = setUp()

    const response = await app.inject({ method: 'GET', url: '/whoami' })

    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe('Bearer')
  })

  it('refuses an invalid token', async () => {
    const { app } = setUp(() => Promise.resolve(null))

    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer nope' }
    })

    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe(
      'Bearer error="invalid_token"'
    )
  })

  it('answers 503 when the token cannot be checked', async () => {
    const { app } = setUp(() => Promise.reject(new Error('sso down')))

    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer token' }
    })

    expect(response.statusCode).toBe(503)
  })

  it.each([
    ['a B2B user', 'org-1'],
    ['a B2C user, who has no organization', null]
  ])('lets %s through', async (_case, organizationId) => {
    const { app } = setUp(() => Promise.resolve(anIdentity({ organizationId })))

    const response = await app.inject({
      method: 'GET',
      url: '/whoami',
      headers: { authorization: 'Bearer token' }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      email: 'alice@example.com',
      organizationId
    })
  })
})

describe('POST /auth/backchannel-logout', () => {
  it('revokes the session of a valid logout token', async () => {
    const { app, store } = setUp()

    const response = await app.inject({
      method: 'POST',
      url: '/auth/backchannel-logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'logout_token=valid'
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(store.revoke).toHaveBeenCalledWith('session-1', expect.any(Date))
  })

  it.each([['logout_token=forged'], ['']])('refuses %j', async payload => {
    const { app, store } = setUp()

    const response = await app.inject({
      method: 'POST',
      url: '/auth/backchannel-logout',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload
    })

    expect(response.statusCode).toBe(400)
    expect(store.revoke).not.toHaveBeenCalled()
  })
})
