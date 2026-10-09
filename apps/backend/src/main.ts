import { pino } from 'pino'
import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { postgresDeduplicator } from './events/dedupe.ts'
import { createRelay } from './events/outbox.ts'
import { createMessageHandler } from './events/router.ts'
import { listenToChanges } from './infra/changes.ts'
import { assertRowLevelSecurity, createDb, migrateDb } from './infra/db.ts'
import { createMailer } from './infra/mail.ts'
import {
  requestSpaceSync,
  startConsumer,
  startPublisher
} from './infra/rabbitmq.ts'
import { connectIdentityProvider } from './modules/auth/index.ts'
import { settingsRoutes } from './modules/settings/events.ts'
import { SETTINGS_CHANNEL } from './modules/settings/routes.ts'
import { knowsAnySpace, spaceRoutes } from './modules/spaces/events.ts'
import { accountRoutes } from './modules/wikis/accounts.ts'
import { emailInvite, INVITE_EMAIL_JOB } from './modules/wikis/inviteEmails.ts'
import { WIKI_CHANNEL } from './modules/wikis/live.ts'
import { PURGE_WIKI_JOB, purgeWiki } from './modules/wikis/store.ts'
import { createScheduler } from './scheduler/scheduler.ts'

const config = loadConfig()
const logger = pino({ level: config.LOG_LEVEL })
const spaces = config.SPACE_INTEGRATION === 'true'

const { sql, db } = createDb(config.DATABASE_URL)
await assertRowLevelSecurity(sql)
await migrateDb(db)

let accepting = false
const settingsChanges = await listenToChanges(sql, SETTINGS_CHANNEL)
const wikiChanges = await listenToChanges(sql, WIKI_CHANNEL)
const server = await buildApp({
  logger,
  db,
  settingsChanges,
  wikiChanges,
  ...(await connectIdentityProvider({
    db,
    oidc: {
      issuer: new URL(config.OIDC_ISSUER),
      clientId: config.OIDC_CLIENT_ID,
      clientSecret: config.OIDC_CLIENT_SECRET,
      audience: config.OIDC_AUDIENCE
    }
  })),
  isReady: async () => accepting && (await sql`select 1`).length === 1,
  gristOrigins: config.GRIST_ORIGINS
})
await server.listen({ host: config.HTTP_HOST, port: config.HTTP_PORT })

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
  // fixes its dead letter key; without the integration they find no route.
  createMessageHandler({
    routes: new Map([
      ...(spaces ? spaceRoutes() : []),
      ...accountRoutes,
      ...settingsRoutes
    ]),
    dedupe: postgresDeduplicator(db, 'twake-pages'),
    logger
  })
)
// A sync request fans out to every app and every space, so it is sent only
// while no space is known, once the queue is bound to receive the answers.
// The nightly sync repairs what a failed request misses, so it never stops
// the start.
if (spaces && !(await knowsAnySpace(db))) {
  try {
    await requestSpaceSync(
      config.RABBITMQ_URL,
      config.RABBITMQ_SPACE_EXCHANGE,
      logger
    )
    logger.info('no space known yet, sync of every organization requested')
  } catch (error) {
    logger.error({ err: error }, 'space sync request failed')
  }
}
const send = createMailer(config, logger)
const stopScheduler = createScheduler({
  db,
  logger,
  handlers: {
    [PURGE_WIKI_JOB]: purgeWiki,
    [INVITE_EMAIL_JOB]: emailInvite({ appUrl: config.APP_URL, send })
  }
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
    await wikiChanges.close()
    await sql.end({ timeout: 5 })
  } catch (error) {
    logger.error({ err: error }, 'shutdown failed')
    process.exitCode = 1
  }
}

process.once('SIGTERM', signal => void shutdown(signal))
process.once('SIGINT', signal => void shutdown(signal))
