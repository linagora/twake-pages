import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import { aUser, startApp, type TestUser } from '../../testing/app.ts'
import { keepSettings } from './events.ts'

const { sql, db } = createDb(inject('databaseUrl'))
let api: Awaited<ReturnType<typeof startApp>>

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

const settingsOf = async (user: TestUser) =>
  (await api.as(user).get('/settings')).json<unknown>()

describe('GET /settings', () => {
  it("answers with the person's settings", async () => {
    const user = aUser()
    await db.transaction(tx =>
      keepSettings(tx, 1, {
        email: user.email.toLowerCase(),
        language: 'fr',
        timezone: 'Europe/Paris',
        theme: 'dark',
        avatar: 'https://avatars.example.com/a.png',
        display_name: 'Alice M.'
      })
    )

    expect(await settingsOf(user)).toEqual({
      version: 1,
      language: 'fr',
      timezone: 'Europe/Paris',
      theme: 'dark',
      avatar: 'https://avatars.example.com/a.png',
      name: 'Alice M.'
    })
  })

  it('follows the system theme for someone who never chose one', async () => {
    expect(await settingsOf(aUser())).toEqual({
      version: -1,
      language: null,
      timezone: null,
      theme: 'auto',
      avatar: null,
      name: null
    })
  })
})
