import type { Logger } from 'pino'
import { z } from 'zod'
import type { Tx } from '../infra/db.ts'
import type { Delivery } from '../infra/rabbitmq.ts'
import type { Deduplicator } from './dedupe.ts'
import { parsePlatformEvent, type PlatformEvent } from './envelope.ts'

export type Handler<E> = (event: E, tx: Tx) => Promise<void>

// Thrown by a handler for an event it can never process, so it is dropped.
export class MalformedEventError extends Error {}

// Thrown by a handler for a well-formed event that contradicts the copy; kept on
// the dead letter queue to be looked at and replayed.
export class RejectedEventError extends Error {}

export function parseOrDrop<T extends z.ZodType>(
  schema: T,
  value: unknown,
  label: string
): z.output<T> {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new MalformedEventError(`${label}: ${z.prettifyError(result.error)}`)
  }
  return result.data
}

export type Outcome =
  'processed' | 'duplicate' | 'unrouted' | 'malformed' | 'rejected'

export function createMessageHandler(deps: {
  routes: ReadonlyMap<string, Handler<PlatformEvent>>
  dedupe: Deduplicator
  logger: Logger
}) {
  const { routes, dedupe, logger } = deps

  return async (delivery: Delivery): Promise<Outcome> => {
    const context = {
      routingKey: delivery.routingKey,
      messageId: delivery.messageId
    }
    const parsed = parsePlatformEvent(delivery)
    if (!parsed.ok) {
      logger.error(
        { ...context, error: parsed.error },
        'dropping malformed event'
      )
      return 'malformed'
    }
    const event = parsed.event
    const handler = routes.get(event.routingKey)
    if (!handler) {
      logger.debug(context, 'no handler for event')
      return 'unrouted'
    }
    let processed: boolean
    try {
      processed = await dedupe.once(
        { source: 'amqp', id: event.messageId },
        tx => handler(event, tx)
      )
    } catch (error) {
      if (error instanceof RejectedEventError) {
        logger.warn(
          { ...context, reason: error.message },
          'event sent to the dead letter queue'
        )
        return 'rejected'
      }
      if (!(error instanceof MalformedEventError)) throw error
      logger.error(
        { ...context, error: error.message },
        'dropping malformed event'
      )
      return 'malformed'
    }
    logger.info({ ...context, duplicate: !processed }, 'event handled')
    return processed ? 'processed' : 'duplicate'
  }
}
