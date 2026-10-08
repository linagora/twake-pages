import { randomUUID } from 'node:crypto'
import { sql as raw } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { PlatformEvent } from '../../events/envelope.ts'
import { outbox } from '../../events/schema.ts'
import { createDb } from '../../infra/db.ts'
import { aPageIn, aUser, startApp, type TestUser } from '../../testing/app.ts'
import { spaceRoutes } from './events.ts'

let api: Awaited<ReturnType<typeof startApp>>
const { sql, db } = createDb(inject('databaseUrl'))
const routes = spaceRoutes()

beforeAll(async () => {
  api = await startApp()
})

afterAll(async () => {
  await api.close()
  await sql.end()
})

function deliver(routingKey: string, body: object) {
  const handler = routes.get(routingKey)
  if (!handler) throw new Error(`no handler for ${routingKey}`)
  const event: PlatformEvent = {
    routingKey,
    messageId: randomUUID(),
    body: { timestamp: new Date().toISOString(), ...body }
  }
  return db.transaction(tx => handler(event, tx))
}

const member = (user: TestUser, role: string) => ({
  uuid: user.userId,
  username: user.email.split('@')[0],
  email: user.email,
  role
})

interface WikiSummary {
  id: string
  name: string
  description: string
  kind: 'personal' | 'shared' | 'space'
  role: 'viewer' | 'editor' | 'admin'
  homePageId: string
  unread: number
}

async function spaceWikis(user: TestUser) {
  return (await api.as(user).get('/wikis'))
    .json<{ wikis: WikiSummary[] }>()
    .wikis.filter(wiki => wiki.kind === 'space')
}

/** The one space wiki the person sees. */
async function spaceWikiOf(user: TestUser) {
  const [wiki, ...more] = await spaceWikis(user)
  if (!wiki || more.length > 0) throw new Error('expected one space wiki')
  return wiki
}

async function versionOf(user: TestUser, wikiId: string) {
  return (await api.as(user).get(`/wikis/${wikiId}`)).json<{
    version: number
  }>().version
}

/** The provisioned events waiting in the outbox for RabbitMQ, oldest first. */
async function provisionedEvents(spaceId: string) {
  const queued = await db
    .select({ event: outbox.event })
    .from(outbox)
    .where(raw`${outbox.event} -> 'data' ->> 'space_id' = ${spaceId}`)
    .orderBy(outbox.id)
  return queued.map(row => row.event)
}

describe('twake.space.created', () => {
  it('creates the wiki of the space, named after it, with its members in their space roles', async () => {
    const admin = aUser()
    const viewer = aUser({ organizationId: admin.organizationId })

    await deliver('twake.space.created', {
      organizationId: admin.organizationId,
      id: randomUUID(),
      name: 'Équipe design',
      members: [member(admin, 'admin'), member(viewer, 'viewer')]
    })

    expect(await spaceWikis(admin)).toEqual([
      {
        id: expect.any(String) as string,
        name: 'Équipe design',
        description: '',
        kind: 'space',
        role: 'admin',
        homePageId: expect.any(String) as string,
        unread: 0
      }
    ])
    expect(await spaceWikis(viewer)).toEqual([
      expect.objectContaining({ name: 'Équipe design', role: 'viewer' })
    ])
    expect(
      await spaceWikis(aUser({ organizationId: admin.organizationId }))
    ).toEqual([])
  })

  it('announces the wiki as provisioned, and the same event again on replay, creating nothing', async () => {
    const admin = aUser()
    const spaceId = randomUUID()
    const created = {
      organizationId: admin.organizationId,
      id: spaceId,
      name: 'Ops',
      members: [member(admin, 'admin')]
    }

    await deliver('twake.space.created', created)
    await deliver('twake.space.created', { ...created, name: 'Renamed' })

    const wikis = await spaceWikis(admin)
    expect(wikis).toEqual([expect.objectContaining({ name: 'Ops' })])
    const [first, replayed, ...more] = await provisionedEvents(spaceId)
    expect(first).toEqual({
      specversion: '1.0',
      id: expect.any(String) as string,
      source: 'twake://pages',
      type: 'com.twake.pages.space.provisioned.v1',
      twakeorg: admin.organizationId,
      data: { space_id: spaceId, resource: { kind: 'wiki', id: wikis[0]?.id } }
    })
    expect(replayed).toEqual(first)
    expect(more).toEqual([])
  })
})

describe('space members', () => {
  it('gives a person added to the space the wiki, in their space role, and follows its changes', async () => {
    const admin = aUser()
    const newcomer = aUser({ organizationId: admin.organizationId })
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')]
    })

    await deliver('twake.space.member.added', {
      ...space,
      members: [member(newcomer, 'viewer')]
    })
    expect(await spaceWikis(newcomer)).toEqual([
      expect.objectContaining({ name: 'Ops', role: 'viewer' })
    ])

    await deliver('twake.space.member.role.changed', {
      ...space,
      members: [member(newcomer, 'editor')]
    })
    expect(await spaceWikis(newcomer)).toEqual([
      expect.objectContaining({ name: 'Ops', role: 'editor' })
    ])
  })

  it('takes the wiki from a person removed from the space, and keeps the pages they wrote', async () => {
    const admin = aUser()
    const leaver = aUser({ organizationId: admin.organizationId })
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin'), member(leaver, 'editor')]
    })
    const wiki = await spaceWikiOf(leaver)
    const pageId = await aPageIn(db, leaver, wiki.id, {
      title: 'Runbook',
      position: 'a0'
    })

    await deliver('twake.space.member.removed', {
      ...space,
      members: [{ uuid: leaver.userId, email: leaver.email }]
    })

    expect(await spaceWikis(leaver)).toEqual([])
    expect((await api.as(leaver).get(`/wikis/${wiki.id}`)).statusCode).toBe(404)
    expect((await api.as(admin).get(`/wikis/${wiki.id}/tree`)).json()).toEqual({
      version: expect.any(Number) as number,
      pages: [expect.objectContaining({ id: pageId, title: 'Runbook' })]
    })
  })

  it('takes the wiki from a person the event names by email only', async () => {
    const admin = aUser()
    const leaver = aUser({ organizationId: admin.organizationId })
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin'), member(leaver, 'editor')]
    })

    await deliver('twake.space.member.removed', {
      ...space,
      members: [{ email: leaver.email }]
    })

    expect(await spaceWikis(leaver)).toEqual([])
    expect(await spaceWikis(admin)).toEqual([
      expect.objectContaining({ name: 'Ops' })
    ])
  })
})

describe('twake.space.updated', () => {
  it('renames the wiki with the space', async () => {
    const admin = aUser()
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')]
    })

    await deliver('twake.space.updated', { ...space, name: 'Operations' })

    expect(await spaceWikis(admin)).toEqual([
      expect.objectContaining({ name: 'Operations' })
    ])
  })
})

describe('live updates', () => {
  it('moves the version of the wiki each time the space changes its members or its name', async () => {
    const admin = aUser()
    const newcomer = aUser({ organizationId: admin.organizationId })
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')]
    })
    const wiki = await spaceWikiOf(admin)
    const versions = [await versionOf(admin, wiki.id)]

    await deliver('twake.space.member.added', {
      ...space,
      members: [member(newcomer, 'viewer')]
    })
    versions.push(await versionOf(admin, wiki.id))
    await deliver('twake.space.member.role.changed', {
      ...space,
      members: [member(newcomer, 'editor')]
    })
    versions.push(await versionOf(admin, wiki.id))
    await deliver('twake.space.updated', { ...space, name: 'Operations' })
    versions.push(await versionOf(admin, wiki.id))
    await deliver('twake.space.member.removed', {
      ...space,
      members: [{ uuid: newcomer.userId }]
    })
    versions.push(await versionOf(admin, wiki.id))

    expect(new Set(versions).size).toBe(5)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
  })

  it('leaves the version alone when an event changes nothing', async () => {
    const admin = aUser()
    const viewer = aUser({ organizationId: admin.organizationId })
    const created = {
      organizationId: admin.organizationId,
      id: randomUUID(),
      name: 'Ops',
      members: [member(admin, 'admin'), member(viewer, 'viewer')]
    }
    await deliver('twake.space.created', created)
    const wiki = await spaceWikiOf(admin)
    const before = await versionOf(admin, wiki.id)

    await deliver('twake.space.created', created)
    await deliver('twake.space.member.added', {
      ...created,
      members: [member(viewer, 'viewer')]
    })
    await deliver('twake.space.updated', { ...created, name: 'Ops' })

    expect(await versionOf(admin, wiki.id)).toBe(before)
  })
})
