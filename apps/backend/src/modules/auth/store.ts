import { eq, lt } from 'drizzle-orm'
import type { Db } from '../../infra/db.ts'
import { oidcRevokedSessions } from './schema.ts'

export interface AuthStore {
  isRevoked: (sessionId: string) => Promise<boolean>
  revoke: (sessionId: string, until: Date) => Promise<void>
}

export function postgresAuthStore(db: Db): AuthStore {
  return {
    async isRevoked(sessionId) {
      const rows = await db
        .select({ sid: oidcRevokedSessions.sid })
        .from(oidcRevokedSessions)
        .where(eq(oidcRevokedSessions.sid, sessionId))
        .limit(1)
      return rows.length > 0
    },

    async revoke(sessionId, until) {
      await db.transaction(async tx => {
        await tx
          .delete(oidcRevokedSessions)
          .where(lt(oidcRevokedSessions.expiresAt, new Date()))
        await tx
          .insert(oidcRevokedSessions)
          .values({ sid: sessionId, expiresAt: until })
          .onConflictDoNothing()
      })
    }
  }
}
