import type { Logger } from 'pino'
import { versionStreams, type Changes } from './infra/changes.ts'
import type { Db } from './infra/db.ts'
import { createServer } from './infra/http.ts'
import {
  postgresAuthStore,
  registerAuth,
  type Authenticate,
  type IdentityProvider
} from './modules/auth/index.ts'
import { registerFavorites } from './modules/pages/favorites.ts'
import { registerLabels } from './modules/pages/labels.ts'
import { registerRecent } from './modules/pages/recent.ts'
import { registerPages } from './modules/pages/routes.ts'
import { registerSearch } from './modules/pages/search.ts'
import { registerSettings } from './modules/settings/routes.ts'
import { registerLive } from './modules/wikis/live.ts'
import { registerWikis } from './modules/wikis/routes.ts'

export async function buildApp(deps: {
  logger: Logger
  db: Db
  settingsChanges: Changes
  wikiChanges: Changes
  provider: IdentityProvider
  authenticate: Authenticate
  isReady: () => Promise<boolean>
  gristOrigins: string[]
}) {
  const app = createServer({ logger: deps.logger, isReady: deps.isReady })
  // The frontend serves its own routes, such as /wikis/<id>, on the same origin.
  await app.register(
    api => {
      const requireIdentity = registerAuth(api, {
        authenticate: deps.authenticate,
        provider: deps.provider,
        store: postgresAuthStore(deps.db)
      })
      const streamVersions = versionStreams(api)
      registerWikis(api, { db: deps.db, requireIdentity })
      registerPages(api, {
        db: deps.db,
        requireIdentity,
        gristOrigins: deps.gristOrigins
      })
      registerLabels(api, { db: deps.db, requireIdentity })
      registerFavorites(api, { db: deps.db, requireIdentity })
      registerRecent(api, { db: deps.db, requireIdentity })
      registerSearch(api, { db: deps.db, requireIdentity })
      registerLive(api, {
        db: deps.db,
        requireIdentity,
        changes: deps.wikiChanges,
        streamVersions
      })
      registerSettings(api, {
        db: deps.db,
        requireIdentity,
        changes: deps.settingsChanges,
        streamVersions
      })
      return Promise.resolve()
    },
    { prefix: '/api' }
  )
  await app.ready()
  return app
}
