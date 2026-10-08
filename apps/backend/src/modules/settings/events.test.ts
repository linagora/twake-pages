import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, describe, expect, inject, it } from 'vitest'
import type { PlatformEvent } from '../../events/envelope.ts'
import { MalformedEventError } from '../../events/router.ts'
import { createDb } from '../../infra/db.ts'
import { settingsRoutes } from './events.ts'
import { userSettings } from './schema.ts'

const { sql, db } = createDb(inject('databaseUrl'))

afterAll(async () => {
  await sql.end()
})

function deliver(version: number, payload: Record<string, unknown>) {
  const handler = settingsRoutes.get('user.settings.updated')
  if (!handler) throw new Error('no handler for user.settings.updated')
  const event: PlatformEvent = {
    routingKey: 'user.settings.updated',
    messageId: randomUUID(),
    body: {
      source: 'common-settings',
      nickname: 'alice',
      request_id: randomUUID(),
      timestamp: Date.now(),
      version,
      payload: { nickname: 'alice', version, ...payload }
    }
  }
  return db.transaction(tx => handler(event, tx))
}

const anEmail = () => `user-${randomUUID()}@example.com`

async function settingsOf(email: string) {
  const [row] = await db
    .select()
    .from(userSettings)
    .where(eq(userSettings.email, email))
  return row
}

describe('user.settings.updated', () => {
  it('keeps the settings of someone Pages has not met yet, by their email in lower case', async () => {
    const email = anEmail()

    await deliver(3, {
      email: email.toUpperCase(),
      language: 'fr',
      timezone: 'Europe/Paris',
      theme: 'dark',
      avatar: 'https://avatars.example.com/alice.png',
      first_name: 'Alice',
      last_name: 'Martin',
      display_name: 'Alice M.'
    })

    expect(await settingsOf(email)).toEqual({
      email,
      version: 3,
      language: 'fr',
      timezone: 'Europe/Paris',
      theme: 'dark',
      avatar: 'https://avatars.example.com/alice.png',
      name: 'Alice M.'
    })
  })

  it('names the person from their first and last names without a display name', async () => {
    const email = anEmail()

    await deliver(1, { email, first_name: 'Alice', last_name: 'Martin' })

    expect(await settingsOf(email)).toMatchObject({ name: 'Alice Martin' })
  })

  it('replaces every setting, since each message carries all of them', async () => {
    const email = anEmail()
    await deliver(1, { email, language: 'fr', theme: 'dark' })

    await deliver(2, { email, language: 'vi' })

    expect(await settingsOf(email)).toMatchObject({
      version: 2,
      language: 'vi',
      theme: null
    })
  })

  it('ignores a message no newer than the settings it has', async () => {
    const email = anEmail()
    await deliver(2, { email, language: 'fr' })

    await deliver(2, { email, language: 'vi' })
    await deliver(1, { email, language: 'ru' })

    expect(await settingsOf(email)).toMatchObject({
      version: 2,
      language: 'fr'
    })
  })

  it('keeps an unknown theme out', async () => {
    const email = anEmail()

    await deliver(1, { email, theme: 'sepia' })

    expect(await settingsOf(email)).toMatchObject({ theme: null })
  })

  it('drops a message without an email', async () => {
    await expect(deliver(1, { language: 'fr' })).rejects.toThrow(
      MalformedEventError
    )
  })
})
