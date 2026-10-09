import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))

const publish = `
const { RabbitMQClient } = await import('@linagora/rabbitmq-client')
const [exchange, routingKey, messageId, body] = process.argv.slice(1)
const client = new RabbitMQClient({ url: process.env.RABBITMQ_URL })
await client.init()
await client.publish(exchange, routingKey, JSON.parse(body), { messageId })
await client.close()
`

const provisionedWiki = `
const { default: postgres } = await import('postgres')
const sql = postgres(process.env.DATABASE_URL)
const [row] = await sql\`
  select event -> 'data' -> 'resource' ->> 'id' as id,
    event -> 'data' -> 'resource' ->> 'kind' as kind from outbox
  where event ->> 'type' = 'com.twake.pages.space.provisioned.v1'
    and event -> 'data' ->> 'space_id' = \${process.argv[1]}
    and sent_at is not null\`
await sql.end()
process.stdout.write(JSON.stringify(row ?? null))
`

const sentPageEvents = `
const { default: postgres } = await import('postgres')
const sql = postgres(process.env.DATABASE_URL)
const [type, pageId] = process.argv.slice(1)
const rows = await sql\`
  select event from outbox
  where event ->> 'type' = \${type}
    and event -> 'data' -> 'object' ->> 'id' = \${pageId}
    and sent_at is not null
  order by id\`
await sql.end()
process.stdout.write(JSON.stringify(rows.map(row => row.event)))
`

const revokedSession = `
const { default: postgres } = await import('postgres')
const sql = postgres(process.env.DATABASE_URL)
await sql\`
  insert into oidc_revoked_sessions (sid, expires_at)
  values (\${process.argv[1]}, now() + interval '1 hour')
  on conflict do nothing\`
await sql.end()
`

function inBackend(script: string, ...args: string[]) {
  return execFileSync(
    'docker',
    [
      'compose',
      '-p',
      'twake-pages-e2e',
      '-f',
      'docker-compose.yml',
      '-f',
      'e2e/docker-compose.e2e.yml',
      'exec',
      '-T',
      'backend',
      'node',
      '--input-type=module',
      '-e',
      script,
      ...args
    ],
    { cwd: root, encoding: 'utf8' }
  )
}

/** Publishes a space event the way ldap-rest does, on its `space` exchange. */
export function publishPlatformEvent(
  routingKey: `twake.space.${string}`,
  body: { organizationId: string } & Record<string, unknown>
) {
  inBackend(
    publish,
    'space',
    routingKey,
    randomUUID(),
    JSON.stringify({ timestamp: new Date().toISOString(), ...body })
  )
}

/**
 * The resource TwakeSpace learns from the space's provisioned event, once
 * RabbitMQ has confirmed it; null until then.
 */
export function wikiOfSpace(spaceId: string) {
  return JSON.parse(inBackend(provisionedWiki, spaceId)) as {
    id: string
    kind: string
  } | null
}

/**
 * The `page.<action>` events of a page, once RabbitMQ has confirmed them on
 * the activity exchange, the first one first.
 */
export function pageEvents(action: string, pageId: string) {
  return JSON.parse(
    inBackend(sentPageEvents, `com.twake.pages.page.${action}.v1`, pageId)
  ) as {
    type: string
    data: Record<string, unknown>
  }[]
}

/**
 * Revokes an SSO session at the backend, as the back-channel logout of the
 * SSO does, which the mock SSO does not send.
 */
export function revokeAtBackend(sid: string) {
  inBackend(revokedSession, sid)
}
