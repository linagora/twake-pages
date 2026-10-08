import {
  RabbitMQContainer,
  type StartedRabbitMQContainer
} from '@testcontainers/rabbitmq'
import { connect, type Channel, type ChannelModel } from 'amqplib'
import { pino } from 'pino'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi
} from 'vitest'
import type { OutgoingEvent } from '../events/envelope.ts'
import type { Outcome } from '../events/router.ts'
import {
  requestSpaceSync,
  startConsumer,
  startPublisher,
  type Consumer,
  type ConsumerNames,
  type Delivery
} from './rabbitmq.ts'

const names: ConsumerNames = {
  spaceExchange: 'space',
  b2bExchange: 'b2b',
  authExchange: 'auth',
  settingsExchange: 'settings',
  queue: 'platform.all.twake-pages',
  deadLetterExchange: 'twake-pages.dlx'
}
const QUEUE = names.queue
const DEAD_LETTER_QUEUE = `${QUEUE}.dlq`
const ACTIVITY_EXCHANGE = 'activity'

let container: StartedRabbitMQContainer
let broker: ChannelModel
let channel: Channel
let consumer: Consumer | undefined

beforeAll(async () => {
  container = await new RabbitMQContainer('rabbitmq:4.1').start()
  broker = await connect(container.getAmqpUrl())
  channel = await broker.createChannel()
}, 120_000)

afterEach(async () => {
  await consumer?.close()
  consumer = undefined
  await channel.purgeQueue(QUEUE)
  await channel.purgeQueue(DEAD_LETTER_QUEUE)
})

afterAll(async () => {
  await broker.close()
  await container.stop()
})

async function consume(
  handle: (delivery: Delivery) => Promise<Outcome>,
  under = names
): Promise<void> {
  consumer = await startConsumer(
    container.getAmqpUrl(),
    under,
    pino({ level: 'silent' }),
    handle,
    { retryDelayMs: 10 }
  )
}

const unreachable = () =>
  Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })

function publish(
  exchange: string,
  key: string,
  messageId?: string,
  content = Buffer.from(JSON.stringify({ key }))
): void {
  channel.publish(exchange, key, content, {
    persistent: true,
    ...(messageId && { messageId })
  })
}

async function ready(queue: string): Promise<number> {
  return (await channel.checkQueue(queue)).messageCount
}

describe('startConsumer', () => {
  it('hands a space event to the router and acks it once handled', async () => {
    const handle = vi.fn<(d: Delivery) => Promise<Outcome>>()
    handle.mockResolvedValue('processed')
    await consume(handle)

    publish('space', 'twake.space.created', 'm-1')

    await vi.waitFor(() => {
      expect(handle).toHaveBeenCalledWith({
        routingKey: 'twake.space.created',
        messageId: 'm-1',
        body: { key: 'twake.space.created' }
      })
    })
    await consumer?.close()
    consumer = undefined
    expect(await ready(QUEUE)).toBe(0)
  })

  it('receives account deletions from the b2b and auth exchanges only', async () => {
    const handle = vi.fn<(d: Delivery) => Promise<Outcome>>()
    handle.mockResolvedValue('processed')
    await consume(handle)

    publish('b2b', 'domain.user.created', 'm-1')
    publish('b2b', 'domain.user.deleted', 'm-2')
    publish('auth', 'user.deleted', 'm-3')
    publish('b2b', 'domain.organization.deleted', 'm-4')

    await vi.waitFor(() => {
      expect(handle).toHaveBeenCalledTimes(3)
    })
    expect(handle.mock.calls.map(([delivery]) => delivery.routingKey)).toEqual([
      'domain.user.deleted',
      'user.deleted',
      'domain.organization.deleted'
    ])
  })

  it('receives settings updates, and not the requests to change them', async () => {
    const handle = vi.fn<(d: Delivery) => Promise<Outcome>>()
    handle.mockResolvedValue('processed')
    await consume(handle)

    publish('settings', 'user.settings.update', 'm-1')
    publish('settings', 'user.settings.updated', 'm-2')

    await vi.waitFor(() => {
      expect(handle).toHaveBeenCalledTimes(1)
    })
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ routingKey: 'user.settings.updated' })
    )
  })

  it('names a settings update sent without an id by its content', async () => {
    const handle = vi.fn<(d: Delivery) => Promise<Outcome>>()
    handle.mockResolvedValue('processed')
    await consume(handle)

    publish('settings', 'user.settings.updated')
    publish('settings', 'user.settings.updated')
    publish('space', 'twake.space.updated')

    await vi.waitFor(() => {
      expect(handle).toHaveBeenCalledTimes(3)
    })
    const [first, second, space] = handle.mock.calls.map(([d]) => d.messageId)
    expect(first).toMatch(/^sha256:/)
    expect(second).toBe(first)
    expect(space).toBeUndefined()
  })

  it('delivers to one instance at a time, so events stay in order', async () => {
    const first = vi.fn<(d: Delivery) => Promise<Outcome>>()
    first.mockResolvedValue('processed')
    const second = vi.fn<(d: Delivery) => Promise<Outcome>>()
    second.mockResolvedValue('processed')
    await consume(first)
    const other = await startConsumer(
      container.getAmqpUrl(),
      names,
      pino({ level: 'silent' }),
      second
    )

    try {
      for (const id of ['m-1', 'm-2', 'm-3', 'm-4']) {
        publish('space', 'twake.space.updated', id)
      }

      await vi.waitFor(() => {
        expect(first).toHaveBeenCalledTimes(4)
      })
      expect(second).not.toHaveBeenCalled()
    } finally {
      await other.close()
    }
  })

  it('dead letters an event the router rejects', async () => {
    await consume(() => Promise.resolve('rejected'))

    publish('space', 'twake.space.deleted', 'm-1')

    await vi.waitFor(async () => {
      expect(await ready(DEAD_LETTER_QUEUE)).toBe(1)
    })
    expect(await ready(QUEUE)).toBe(0)
  })

  it('dead letters a message that is not JSON', async () => {
    const handle = vi.fn<(d: Delivery) => Promise<Outcome>>()
    await consume(handle)

    publish('space', 'twake.space.created', 'm-1', Buffer.from('{'))

    await vi.waitFor(async () => {
      expect(await ready(DEAD_LETTER_QUEUE)).toBe(1)
    })
    expect(handle).not.toHaveBeenCalled()
  })

  it('dead letters an event that keeps failing, and goes on with the next', async () => {
    const handle = vi.fn<(d: Delivery) => Promise<Outcome>>()
    handle.mockImplementation(delivery =>
      delivery.messageId === 'm-1'
        ? Promise.reject(new Error('bug'))
        : Promise.resolve('processed')
    )
    await consume(handle)

    publish('space', 'twake.space.updated', 'm-1')
    publish('space', 'twake.space.updated', 'm-2')

    await vi.waitFor(() => {
      expect(handle).toHaveBeenLastCalledWith(
        expect.objectContaining({ messageId: 'm-2' })
      )
    })
    expect(
      handle.mock.calls.filter(([delivery]) => delivery.messageId === 'm-1')
    ).toHaveLength(5)
    await vi.waitFor(async () => {
      expect(await ready(DEAD_LETTER_QUEUE)).toBe(1)
    })
  })

  it('keeps retrying while the database is unreachable', async () => {
    const handle = vi.fn<(d: Delivery) => Promise<Outcome>>()
    for (let i = 0; i < 8; i++) handle.mockRejectedValueOnce(unreachable())
    handle.mockResolvedValue('processed')
    await consume(handle)

    publish('space', 'twake.space.updated', 'm-1')

    await vi.waitFor(
      () => {
        expect(handle).toHaveBeenCalledTimes(9)
      },
      { timeout: 10_000 }
    )
    await consumer?.close()
    consumer = undefined
    expect(await ready(QUEUE)).toBe(0)
    expect(await ready(DEAD_LETTER_QUEUE)).toBe(0)
  })

  it('retries an event whose handling failed until it succeeds', async () => {
    const handle = vi.fn<(d: Delivery) => Promise<Outcome>>()
    handle
      .mockRejectedValueOnce(new Error('db down'))
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue('processed')
    await consume(handle)

    publish('space', 'twake.space.updated', 'm-1')

    await vi.waitFor(
      () => {
        expect(handle).toHaveBeenCalledTimes(3)
      },
      { timeout: 10_000 }
    )
    await consumer?.close()
    consumer = undefined
    expect(await ready(QUEUE)).toBe(0)
    expect(await ready(DEAD_LETTER_QUEUE)).toBe(0)
  })

  it('follows the exchange and queue names it is given', async () => {
    const renamed: ConsumerNames = {
      spaceExchange: 'staging.space',
      b2bExchange: 'staging.b2b',
      authExchange: 'staging.auth',
      settingsExchange: 'staging.settings',
      queue: 'staging.twake-pages',
      deadLetterExchange: 'staging.twake-pages.dlx'
    }
    const handle = vi.fn<(d: Delivery) => Promise<Outcome>>()
    handle.mockResolvedValue('rejected')
    await consume(handle, renamed)

    publish('space', 'twake.space.created', 'm-1')
    publish('staging.space', 'twake.space.created', 'm-2')
    publish('staging.b2b', 'domain.user.deleted', 'm-3')
    publish('staging.auth', 'user.deleted', 'm-4')
    publish('staging.settings', 'user.settings.updated', 'm-5')

    await vi.waitFor(async () => {
      expect(await ready('staging.twake-pages.dlq')).toBe(4)
    })
    expect(handle.mock.calls.map(([delivery]) => delivery.messageId)).toEqual([
      'm-2',
      'm-3',
      'm-4',
      'm-5'
    ])
  })
})

describe('startPublisher', () => {
  const event: OutgoingEvent = {
    specversion: '1.0',
    id: 'evt-1',
    source: 'twake://pages',
    type: 'com.twake.pages.page.created.v1',
    twakeorg: 'org-1',
    data: { object: { id: 'page-1' } }
  }

  it.each([ACTIVITY_EXCHANGE, 'staging.activity'])(
    'publishes an event on the %s exchange, routed by its type',
    async exchange => {
      const publisher = await startPublisher(
        container.getAmqpUrl(),
        exchange,
        pino({ level: 'silent' })
      )
      await channel.assertExchange(exchange, 'topic', { durable: true })
      const { queue } = await channel.assertQueue('', { exclusive: true })
      await channel.bindQueue(queue, exchange, 'com.twake.pages.#')

      try {
        await publisher.publish(event)

        const message = await vi.waitFor(async () => {
          const got = await channel.get(queue, { noAck: true })
          if (!got) throw new Error('nothing yet')
          return got
        })
        expect(message.fields.routingKey).toBe(event.type)
        expect(message.properties.messageId).toBe(event.id)
        expect(JSON.parse(message.content.toString())).toEqual(event)
      } finally {
        await publisher.close()
      }
    }
  )

  it('confirms an event no one listens to', async () => {
    const publisher = await startPublisher(
      container.getAmqpUrl(),
      ACTIVITY_EXCHANGE,
      pino({ level: 'silent' })
    )

    try {
      await expect(
        publisher.publish({ ...event, type: 'com.twake.pages.unheard.v1' })
      ).resolves.toBeUndefined()
    } finally {
      await publisher.close()
    }
  })

  // A publish settles once RabbitMQ answers: the outbox relay then marks the
  // event sent, or keeps it, and the events behind it, for its next run.
  it('fails when RabbitMQ refuses the event', async () => {
    const publisher = await startPublisher(
      container.getAmqpUrl(),
      ACTIVITY_EXCHANGE,
      pino({ level: 'silent' })
    )
    await channel.assertExchange(ACTIVITY_EXCHANGE, 'topic', { durable: true })
    // A queue that takes no message, and has RabbitMQ refuse what it cannot take.
    const { queue } = await channel.assertQueue('', {
      exclusive: true,
      arguments: { 'x-max-length': 0, 'x-overflow': 'reject-publish' }
    })
    await channel.bindQueue(queue, ACTIVITY_EXCHANGE, 'com.twake.pages.full.#')

    try {
      await expect(
        publisher.publish({ ...event, type: 'com.twake.pages.full.v1' })
      ).rejects.toThrow()
    } finally {
      await publisher.close()
      await channel.deleteQueue(queue)
    }
  })
})

describe('requestSpaceSync', () => {
  it('asks for a sync of every organization on the space exchange', async () => {
    await channel.assertExchange('space', 'topic', { durable: true })
    const { queue } = await channel.assertQueue('', { exclusive: true })
    await channel.bindQueue(queue, 'space', 'twake.space.sync.requested')

    await requestSpaceSync(
      container.getAmqpUrl(),
      'space',
      pino({ level: 'silent' })
    )

    const message = await vi.waitFor(async () => {
      const got = await channel.get(queue, { noAck: true })
      if (!got) throw new Error('nothing yet')
      return got
    })
    expect(message.properties.messageId).toEqual(expect.any(String))
    const body = JSON.parse(message.content.toString()) as object
    expect(body).toEqual({ timestamp: expect.any(String) as string })
  })
})
