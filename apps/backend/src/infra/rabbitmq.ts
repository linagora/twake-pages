import { createHash, randomUUID } from 'node:crypto'
import { DeadLetterError, RabbitMQClient } from '@linagora/rabbitmq-client'
import type { Logger } from 'pino'
import { isTransient } from './db.ts'
import type { OutgoingEvent } from '../events/envelope.ts'
import type { Outcome } from '../events/router.ts'

export interface ConsumerNames {
  spaceExchange: string
  b2bExchange: string
  authExchange: string
  settingsExchange: string
  queue: string
  deadLetterExchange: string
}

export interface Delivery {
  routingKey: string
  messageId: string | undefined
  body: unknown
}

export interface Consumer {
  close(): Promise<void>
}

const MAX_ATTEMPTS = 5

// Common settings sends no message id. A redelivery has the same content, and
// two updates never do, since each carries its own request id and version.
const contentId = (body: unknown) =>
  `sha256:${createHash('sha256').update(JSON.stringify(body)).digest('base64url')}`

// One message at a time on a single active consumer, so the events of a space
// are handled in the order ldap-rest published them, even with several replicas.
// An event that keeps failing is dead lettered so the ones behind it go on.
// Never replay a space event from there (it could undo newer ones, and the next
// space sync repairs it); an account deletion can be replayed once fixed.
// A transient failure, such as the database being down, retries until it passes.
export async function startConsumer(
  url: string,
  names: ConsumerNames,
  logger: Logger,
  handle: (delivery: Delivery) => Promise<Outcome>,
  options: { retryDelayMs?: number } = {}
): Promise<Consumer> {
  const client = new RabbitMQClient({
    url,
    logger,
    prefetch: 1,
    retryDelay: options.retryDelayMs ?? 1000
  })
  await client.init()
  // prefetch 1: only one message is ever being retried.
  let failing = { messageId: undefined as string | undefined, attempts: 0 }
  await client.subscribe(
    names.spaceExchange,
    'twake.space.#',
    names.queue,
    async (body, { routingKey, messageId: sentId }) => {
      const messageId =
        sentId ??
        (routingKey === 'user.settings.updated' ? contentId(body) : undefined)
      let outcome: Outcome
      try {
        outcome = await handle({ routingKey, messageId, body })
      } catch (error) {
        if (isTransient(error)) throw error
        if (failing.messageId !== messageId)
          failing = { messageId, attempts: 0 }
        failing.attempts++
        if (failing.attempts < MAX_ATTEMPTS) throw error
        logger.error(
          { err: error, routingKey, messageId },
          'event sent to the dead letter queue after repeated failures'
        )
        throw new DeadLetterError(`${routingKey} kept failing`)
      }
      if (outcome === 'rejected') {
        throw new DeadLetterError(`${routingKey} rejected`)
      }
    },
    {
      bindings: [
        { exchange: names.b2bExchange, routingKey: 'domain.user.deleted' },
        { exchange: names.authExchange, routingKey: 'user.deleted' },
        {
          exchange: names.b2bExchange,
          routingKey: 'domain.organization.deleted'
        },
        {
          exchange: names.settingsExchange,
          routingKey: 'user.settings.updated'
        }
      ],
      deadLetterExchange: names.deadLetterExchange,
      queueArguments: { 'x-single-active-consumer': true },
      maxRetries: Infinity,
      maxRetryDelay: 60_000
    }
  )
  return { close: () => client.close() }
}

// With no organizationId, ldap-rest answers with a twake.space.synced for every
// space of every organization.
export async function requestSpaceSync(
  url: string,
  spaceExchange: string,
  logger: Logger
): Promise<void> {
  const client = new RabbitMQClient({ url, logger, publishMaxAttempts: 1 })
  await client.init()
  try {
    await client.publish(
      spaceExchange,
      'twake.space.sync.requested',
      { timestamp: new Date().toISOString() },
      { messageId: randomUUID() }
    )
  } finally {
    await client.close()
  }
}

export interface Publisher {
  publish(event: OutgoingEvent): Promise<void>
  close(): Promise<void>
}

// One attempt per call: the outbox relay retries on its next run, and a
// backoff here would hold its transaction open. Not mandatory, since Pages
// runs with no subscriber on the activity exchange when it is standalone.
export async function startPublisher(
  url: string,
  exchange: string,
  logger: Logger
): Promise<Publisher> {
  const client = new RabbitMQClient({ url, logger, publishMaxAttempts: 1 })
  await client.init()
  return {
    async publish(event) {
      await client.publish(
        exchange,
        event.type,
        { ...event },
        {
          messageId: event.id
        }
      )
    },
    close: () => client.close()
  }
}
