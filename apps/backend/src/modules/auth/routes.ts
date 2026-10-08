import type { FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import type { HttpServer } from '../../infra/http.ts'
import type { Authenticate } from './authenticator.ts'
import type { Identity, IdentityProvider } from './oidc.ts'
import type { AuthStore } from './store.ts'

declare module 'fastify' {
  interface FastifyRequest {
    identity: Identity | null
  }
}

// Longer than any access token issued in the revoked session can live.
const REVOCATION_TTL_MS = 24 * 60 * 60 * 1000

const logoutBody = z.object({ logout_token: z.string().min(1) })

function unauthorized(reply: FastifyReply, error: string | null) {
  return reply
    .code(401)
    .header('www-authenticate', error ? `Bearer error="${error}"` : 'Bearer')
    .send({ error: 'unauthorized' })
}

export type RequireIdentity = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<FastifyReply | undefined>

export function registerAuth(
  app: HttpServer,
  deps: {
    authenticate: Authenticate
    provider: IdentityProvider
    store: AuthStore
  }
): RequireIdentity {
  app.decorateRequest('identity', null)
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)))
    }
  )

  const requireIdentity: RequireIdentity = async (request, reply) => {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? []
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return unauthorized(reply, null)
    }
    let identity: Identity | null
    try {
      identity = await deps.authenticate(token)
    } catch (error) {
      request.log.error({ err: error }, 'access token check failed')
      return reply.code(503).send({ error: 'unavailable' })
    }
    if (!identity) return unauthorized(reply, 'invalid_token')
    request.identity = identity
  }

  app.post('/auth/backchannel-logout', async (request, reply) => {
    reply.header('cache-control', 'no-store')
    const body = logoutBody.safeParse(request.body)
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' })
    let sessionId: string
    try {
      sessionId = await deps.provider.verifyLogoutToken(body.data.logout_token)
    } catch (error) {
      request.log.warn({ err: error }, 'logout token refused')
      return reply.code(400).send({ error: 'invalid_request' })
    }
    await deps.store.revoke(sessionId, new Date(Date.now() + REVOCATION_TTL_MS))
    return reply.code(200).send()
  })

  return requireIdentity
}
