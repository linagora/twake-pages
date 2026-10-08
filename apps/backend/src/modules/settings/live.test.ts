import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { createDb } from '../../infra/db.ts'
import { aUser, startApp, type TestUser } from '../../testing/app.ts'
import { openStream } from '../../testing/stream.ts'
import { keepSettings } from './events.ts'

const { sql, db } = createDb(inject('databaseUrl'))
let api: Awaited<ReturnType<typeof startApp>>
let baseUrl: string

beforeAll(async () => {
  api = await startApp()
  baseUrl = await api.listen()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

const keep = (user: TestUser, version: number, language: string) =>
  db.transaction(tx =>
    keepSettings(tx, version, { email: user.email.toLowerCase(), language })
  )

describe('live settings updates', () => {
  it("sends the person's settings version, then each newer one", async () => {
    const alice = aUser()
    await keep(alice, 2, 'fr')
    const stream = openStream(
      `${baseUrl}/api/settings/events`,
      api.tokenOf(alice)
    )

    const first = (await stream.messages.next()).value
    await keep(aUser(), 7, 'vi')
    await keep(alice, 1, 'en')
    await keep(alice, 3, 'ru')
    const second = (await stream.messages.next()).value
    stream.close()

    expect((await stream.response).headers.get('content-type')).toBe(
      'text/event-stream'
    )
    expect(first?.id).toBe('2')
    expect(second?.id).toBe('3')
  })

  it('starts below any version for someone with no settings yet', async () => {
    const stream = openStream(
      `${baseUrl}/api/settings/events`,
      api.tokenOf(aUser())
    )

    expect((await stream.messages.next()).value?.id).toBe('-1')
    stream.close()
  })
})
