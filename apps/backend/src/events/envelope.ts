import type { Delivery } from '../infra/rabbitmq.ts'

export interface OutgoingEvent {
  specversion: '1.0'
  id: string
  source: string
  type: string
  time?: string | undefined
  subject?: string | undefined
  twakeorg?: string | undefined
  twakeactor?: string | undefined
  twakeactorid?: string | undefined
  data: Record<string, unknown>
}

export interface PlatformEvent {
  routingKey: string
  messageId: string
  body: unknown
}

export type ParseResult<T> =
  { ok: true; event: T } | { ok: false; error: string }

export function parsePlatformEvent(
  delivery: Delivery
): ParseResult<PlatformEvent> {
  if (!delivery.messageId) return { ok: false, error: 'missing message id' }
  return {
    ok: true,
    event: {
      routingKey: delivery.routingKey,
      messageId: delivery.messageId,
      body: delivery.body
    }
  }
}
