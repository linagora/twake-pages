import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { PlatformEvent } from '../../events/envelope.ts'
import { RejectedEventError } from '../../events/router.ts'
import { createDb } from '../../infra/db.ts'
import {
  aB2cUser,
  aUser,
  joinWiki,
  startApp,
  wikiRowsOf,
  type TestUser,
  type WikiSummary
} from '../../testing/app.ts'
import type { Role } from './access.ts'
import { accountRoutes } from './accounts.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

function deliver(routingKey: string, body: object) {
  const handler = accountRoutes.get(routingKey)
  if (!handler) throw new Error(`no handler for ${routingKey}`)
  const event: PlatformEvent = { routingKey, messageId: randomUUID(), body }
  return db.transaction(tx => handler(event, tx))
}

const wikisOf = async (user: TestUser) =>
  (await api.as(user).get('/wikis')).json<{ wikis: WikiSummary[] }>().wikis

/** Someone of the person's tenant: their organization, or B2C. */
const aPeerOf = (user: TestUser): TestUser =>
  user.organizationId
    ? aUser({ organizationId: user.organizationId })
    : aB2cUser()

async function aWiki(
  admin: TestUser,
  name: string,
  members: [TestUser, Role][]
) {
  const wiki = (await api.as(admin).post('/wikis', { name })).json<{
    id: string
  }>()
  for (const [user, role] of members) {
    await joinWiki(db, admin, wiki.id, user, role)
  }
  return wiki
}

async function personalWikiOf(user: TestUser) {
  const personal = (await wikisOf(user)).find(wiki => wiki.kind === 'personal')
  if (!personal) throw new Error('no personal wiki')
  return personal
}

describe.each([
  {
    kind: 'B2B, matched by email',
    routingKey: 'domain.user.deleted',
    makeUser: () => aUser(),
    body: (user: TestUser) => ({
      organizationId: user.organizationId,
      internalEmail: user.email
    })
  },
  {
    kind: 'B2B, matched by uuid',
    routingKey: 'domain.user.deleted',
    makeUser: () => aUser(),
    body: (user: TestUser) => ({
      organizationId: user.organizationId,
      uuid: user.userId
    })
  },
  {
    kind: 'B2C, matched by uuid',
    routingKey: 'user.deleted',
    makeUser: () => aB2cUser(),
    body: (user: TestUser) => ({ uuid: user.userId })
  },
  {
    kind: 'B2C, matched by email',
    routingKey: 'user.deleted',
    makeUser: () => aB2cUser(),
    body: (user: TestUser) => ({ internalEmail: user.email })
  }
])('a deleted account ($kind)', ({ routingKey, makeUser, body }) => {
  it('leaves every wiki, and loses its personal wiki', async () => {
    const gone = makeUser()
    const admin = aPeerOf(gone)
    const personal = await personalWikiOf(gone)
    const handbook = await aWiki(admin, 'Handbook', [[gone, 'editor']])

    await deliver(routingKey, body(gone))

    expect((await api.as(gone).get(`/wikis/${handbook.id}`)).statusCode).toBe(
      404
    )
    expect(await wikisOf(admin)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Handbook', role: 'admin' })
      ])
    )
    expect(await wikiRowsOf(db, gone, personal.id)).toEqual([])
  })
})

describe('deleted accounts that cannot be applied', () => {
  it('rejects a B2B deletion without an organization', async () => {
    await expect(
      deliver('domain.user.deleted', { internalEmail: 'a@example.com' })
    ).rejects.toThrow(RejectedEventError)
  })

  it('rejects a B2B deletion without a uuid or an email', async () => {
    await expect(
      deliver('domain.user.deleted', { organizationId: randomUUID() })
    ).rejects.toThrow(RejectedEventError)
  })

  it('rejects a B2C deletion without a uuid or an email', async () => {
    await expect(deliver('user.deleted', { userId: 'alice' })).rejects.toThrow(
      RejectedEventError
    )
  })
})
