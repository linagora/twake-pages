import { pino } from 'pino'
import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { postgresDeduplicator } from './events/dedupe.ts'
import type { PlatformEvent } from './events/envelope.ts'
import { createRelay } from './events/outbox.ts'
import { createMessageHandler, type Handler } from './events/router.ts'
import { listenToChanges } from './infra/changes.ts'
import { assertRowLevelSecurity, createDb, migrateDb } from './infra/db.ts'
import { startConsumer, startPublisher } from './infra/rabbitmq.ts'
import { connectIdentityProvider } from './modules/auth/index.ts'
import { settingsRoutes } from './modules/settings/events.ts'
import { SETTINGS_CHANNEL } from './modules/settings/routes.ts'
import { createScheduler } from './scheduler/scheduler.ts'

const config = loadConfig()
const logger = pino({ level: config.LOG_LEVEL })

const { sql, db } = createDb(config.DATABASE_URL)
await assertRowLevelSecurity(sql)
await migrateDb(db)

let accepting = false
const settingsChanges = await listenToChanges(sql, SETTINGS_CHANNEL)
const server = await buildApp({
  logger,
  db,
  settingsChanges,
  ...(await connectIdentityProvider({
    db,
    oidc: {
      issuer: new URL(config.OIDC_ISSUER),
      clientId: config.OIDC_CLIENT_ID,
      clientSecret: config.OIDC_CLIENT_SECRET,
      audience: config.OIDC_AUDIENCE
    }
  })),
  isReady: async () => accepting && (await sql`select 1`).length === 1
})
await server.listen({ host: config.HTTP_HOST, port: config.HTTP_PORT })

// The events of the wikis, and of the spaces, will be routed here.
const pagesRoutes = new Map<string, Handler<PlatformEvent>>()

const publisher = await startPublisher(
  config.RABBITMQ_URL,
  config.RABBITMQ_ACTIVITY_EXCHANGE,
  logger
)
const consumer = await startConsumer(
  config.RABBITMQ_URL,
  {
    spaceExchange: config.RABBITMQ_SPACE_EXCHANGE,
    b2bExchange: config.RABBITMQ_B2B_EXCHANGE,
    authExchange: config.RABBITMQ_AUTH_EXCHANGE,
    settingsExchange: config.RABBITMQ_SETTINGS_EXCHANGE,
    queue: config.RABBITMQ_QUEUE,
    deadLetterExchange: config.RABBITMQ_DEAD_LETTER_EXCHANGE
  },
  logger,
  // The queue stays bound to space events either way, since its first binding
  // fixes its dead letter key; until they have a route, they are dropped.
  createMessageHandler({
    routes: new Map([...pagesRoutes, ...settingsRoutes]),
    dedupe: postgresDeduplicator(db, 'twake-pages'),
    logger
  })
)
const stopScheduler = createScheduler({
  db,
  logger,
  handlers: {}
}).start(5000)
const stopRelay = createRelay({
  db,
  logger,
  publish: event => publisher.publish(event)
}).start(500)
accepting = true
logger.info('twake-pages backend started')

let stopping = false
async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  accepting = false
  logger.info({ signal }, 'shutting down')
  try {
    await stopScheduler()
    await consumer.close()
    await stopRelay()
    await publisher.close()
    await server.close()
    await settingsChanges.close()
    await sql.end({ timeout: 5 })
  } catch (error) {
    logger.error({ err: error }, 'shutdown failed')
    process.exitCode = 1
  }
}

process.once('SIGTERM', signal => void shutdown(signal))
process.once('SIGINT', signal => void shutdown(signal))
