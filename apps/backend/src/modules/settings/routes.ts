import { eq } from 'drizzle-orm'
import type { Changes, StreamVersions } from '../../infra/changes.ts'
import type { Db } from '../../infra/db.ts'
import type { HttpServer } from '../../infra/http.ts'
import type { RequireIdentity } from '../auth/index.ts'
import { userSettings } from './schema.ts'

// Sent by the user_settings_notify_change trigger.
export const SETTINGS_CHANNEL = 'settings_changes'

// Below any version an event carries, so the first settings kept are newer.
const NEVER_KEPT = -1

export function registerSettings(
  app: HttpServer,
  deps: {
    db: Db
    requireIdentity: RequireIdentity
    changes: Changes
    streamVersions: StreamVersions
  }
) {
  app.get(
    '/settings/events',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const email = identity.email.toLowerCase()
      await deps.streamVersions(request, reply, {
        changes: deps.changes,
        key: email,
        current: async () => {
          const [kept] = await deps.db
            .select({ version: userSettings.version })
            .from(userSettings)
            .where(eq(userSettings.email, email))
          return kept?.version ?? NEVER_KEPT
        }
      })
    }
  )

  app.get(
    '/settings',
    { preHandler: deps.requireIdentity },
    async (request, reply) => {
      const identity = request.identity
      if (!identity) return reply.code(401).send()
      const [kept] = await deps.db
        .select({
          version: userSettings.version,
          language: userSettings.language,
          timezone: userSettings.timezone,
          theme: userSettings.theme,
          avatar: userSettings.avatar,
          name: userSettings.name
        })
        .from(userSettings)
        .where(eq(userSettings.email, identity.email.toLowerCase()))
      return {
        version: kept?.version ?? NEVER_KEPT,
        language: kept?.language ?? null,
        timezone: kept?.timezone ?? null,
        theme: kept?.theme ?? 'auto',
        avatar: kept?.avatar ?? null,
        name: kept?.name ?? null
      }
    }
  )
}
