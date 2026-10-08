import { randomUUID } from 'node:crypto'
import { and, eq, sql as raw } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import type { PlatformEvent } from '../../events/envelope.ts'
import { MalformedEventError } from '../../events/router.ts'
import { outbox } from '../../events/schema.ts'
import { createDb, inTenant } from '../../infra/db.ts'
import {
  aPageIn,
  aUser,
  purgeJobOf,
  startApp,
  wikiRowsOf,
  type TestUser,
  type WikiSummary
} from '../../testing/app.ts'
import { wikiMembers } from '../wikis/schema.ts'
import { PURGE_WIKI_JOB, purgeWiki } from '../wikis/store.ts'
import { knowsAnySpace, spaceRoutes } from './events.ts'

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

const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 6, 9, minute)).toISOString()

const member = (user: TestUser, role: string) => ({
  uuid: user.userId,
  username: user.email.split('@')[0],
  email: user.email,
  role
})

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

/** A space of the person's organization, with them as its admin. */
async function aSpaceOf(admin: TestUser, editors: TestUser[] = []) {
  if (!admin.organizationId) throw new Error('spaces are B2B')
  const space = { organizationId: admin.organizationId, id: randomUUID() }
  await deliver('twake.space.created', {
    ...space,
    name: 'Ops',
    members: [
      member(admin, 'admin'),
      ...editors.map(editor => member(editor, 'editor'))
    ]
  })
  return space
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

  it('drops an event without a space id', async () => {
    await expect(
      deliver('twake.space.created', { organizationId: 'org', name: 'Ops' })
    ).rejects.toThrow(MalformedEventError)
  })
})

describe('space members and name', () => {
  it('gives a person added to the space the wiki, in their space role, and follows its changes', async () => {
    const admin = aUser()
    const newcomer = aUser({ organizationId: admin.organizationId })
    const space = await aSpaceOf(admin)

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

  it('names a person added to the space as they last signed in', async () => {
    const admin = aUser()
    const newcomer = aUser({
      organizationId: admin.organizationId,
      name: 'Nina Dupont'
    })
    await api.as(newcomer).get('/wikis')
    const space = await aSpaceOf(admin)

    await deliver('twake.space.member.added', {
      ...space,
      members: [member(newcomer, 'editor')]
    })

    // No route serves the members yet: this reads them as the list will.
    const wiki = await spaceWikiOf(admin)
    const [membership] = await inTenant(db, admin, tx =>
      tx
        .select({ name: wikiMembers.name })
        .from(wikiMembers)
        .where(
          and(
            eq(wikiMembers.wikiId, wiki.id),
            eq(wikiMembers.userId, newcomer.userId)
          )
        )
    )
    expect(membership).toEqual({ name: 'Nina Dupont' })
  })

  it('renames the wiki with the space', async () => {
    const admin = aUser()
    const space = await aSpaceOf(admin)

    await deliver('twake.space.updated', { ...space, name: 'Operations' })

    expect(await spaceWikis(admin)).toEqual([
      expect.objectContaining({ name: 'Operations' })
    ])
  })
})

describe('twake.space.member.removed', () => {
  it('takes the wiki from a person removed from the space, and keeps the pages they wrote', async () => {
    const admin = aUser()
    const leaver = aUser({ organizationId: admin.organizationId })
    const space = await aSpaceOf(admin, [leaver])
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
    const space = await aSpaceOf(admin, [leaver])

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

describe('twake.space.deleted', () => {
  it('puts the wiki out of reach, until its purge 30 days later', async () => {
    const admin = aUser()
    const space = await aSpaceOf(admin)
    const wiki = await spaceWikiOf(admin)
    const before = await versionOf(admin, wiki.id)

    await deliver('twake.space.deleted', space)

    expect(await spaceWikis(admin)).toEqual([])
    expect((await api.as(admin).get(`/wikis/${wiki.id}`)).statusCode).toBe(404)
    const [row] = await wikiRowsOf(db, admin, wiki.id)
    expect(row?.version).toBeGreaterThan(before)
    const job = await purgeJobOf(db, wiki.id)
    const days = (job.runAt.getTime() - Date.now()) / 86_400_000
    expect(Math.round(days)).toBe(30)
  })

  it('leaves the wiki to the wiki purge job', async () => {
    const admin = aUser()
    const space = await aSpaceOf(admin)
    const wiki = await spaceWikiOf(admin)
    await aPageIn(db, admin, wiki.id, { title: 'Runbook', position: 'a0' })
    await deliver('twake.space.deleted', space)
    const job = await purgeJobOf(db, wiki.id)

    await db.transaction(tx => purgeWiki(job.payload, tx))

    expect(await wikiRowsOf(db, admin, wiki.id)).toEqual([])
  })

  it('deletes the wiki even when the deletion is older than the last event of the space', async () => {
    const admin = aUser()
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')],
      timestamp: at(0)
    })
    await deliver('twake.space.updated', {
      ...space,
      name: 'Renamed',
      timestamp: at(30)
    })

    await deliver('twake.space.deleted', { ...space, timestamp: at(10) })

    expect(await spaceWikis(admin)).toEqual([])
  })
})

describe('a space wiki through the API', () => {
  it('can be neither renamed nor deleted by its admin', async () => {
    const admin = aUser()
    await aSpaceOf(admin)
    const wiki = await spaceWikiOf(admin)

    const renamed = await api.as(admin).patch(`/wikis/${wiki.id}`, {
      name: 'Mine'
    })
    const deleted = await api.as(admin).delete(`/wikis/${wiki.id}`)

    expect([renamed.statusCode, renamed.json()]).toEqual([
      409,
      { error: 'managed' }
    ])
    expect([deleted.statusCode, deleted.json()]).toEqual([
      409,
      { error: 'managed' }
    ])
    expect(await spaceWikis(admin)).toEqual([
      expect.objectContaining({ name: 'Ops' })
    ])
  })
})

describe('live updates', () => {
  it('moves the version of the wiki each time the space changes its members or its name', async () => {
    const admin = aUser()
    const newcomer = aUser({ organizationId: admin.organizationId })
    const space = await aSpaceOf(admin)
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

describe('the order of space events', () => {
  it('ignores an event older than the last one applied to its space', async () => {
    const admin = aUser()
    const other = aUser({ organizationId: admin.organizationId })
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')],
      timestamp: at(0)
    })
    await deliver('twake.space.member.added', {
      ...space,
      members: [member(other, 'editor')],
      timestamp: at(20)
    })

    await deliver('twake.space.member.removed', {
      ...space,
      members: [{ uuid: other.userId }],
      timestamp: at(10)
    })
    await deliver('twake.space.member.role.changed', {
      ...space,
      members: [member(other, 'viewer')],
      timestamp: at(12)
    })
    await deliver('twake.space.updated', {
      ...space,
      name: 'Stale',
      timestamp: at(15)
    })

    expect(await spaceWikis(other)).toEqual([
      expect.objectContaining({ name: 'Ops', role: 'editor' })
    ])
  })

  it('applies events with the same timestamp in the order they arrive', async () => {
    const admin = aUser()
    const other = aUser({ organizationId: admin.organizationId })
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')],
      timestamp: at(0)
    })

    await deliver('twake.space.member.added', {
      ...space,
      members: [member(other, 'viewer')],
      timestamp: at(5)
    })
    await deliver('twake.space.member.role.changed', {
      ...space,
      members: [member(other, 'editor')],
      timestamp: at(5)
    })

    expect(await spaceWikis(other)).toEqual([
      expect.objectContaining({ role: 'editor' })
    ])
  })

  it('announces the wiki again on a late twake.space.created, changing nothing', async () => {
    const admin = aUser()
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    const created = {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')],
      timestamp: at(0)
    }
    await deliver('twake.space.created', created)
    await deliver('twake.space.member.role.changed', {
      ...space,
      members: [member(admin, 'viewer')],
      timestamp: at(10)
    })

    await deliver('twake.space.created', created)

    expect(await spaceWikis(admin)).toEqual([
      expect.objectContaining({ role: 'viewer' })
    ])
    expect(await provisionedEvents(space.id)).toHaveLength(2)
  })

  it('drops a space event without a timestamp', async () => {
    await expect(
      deliver('twake.space.updated', {
        organizationId: 'org',
        id: randomUUID(),
        name: 'Ops',
        timestamp: undefined
      })
    ).rejects.toThrow(MalformedEventError)
  })
})

describe('twake.space.synced', () => {
  it('creates the wiki of a space it never heard of, with its members, and announces it', async () => {
    const admin = aUser()
    const viewer = aUser({ organizationId: admin.organizationId })
    const space = { organizationId: admin.organizationId, id: randomUUID() }

    await deliver('twake.space.synced', {
      ...space,
      name: 'Roadmap',
      members: [member(admin, 'admin'), member(viewer, 'viewer')],
      groups: []
    })

    const wiki = await spaceWikiOf(admin)
    expect(wiki).toEqual(
      expect.objectContaining({ name: 'Roadmap', role: 'admin' })
    )
    expect(await spaceWikis(viewer)).toEqual([
      expect.objectContaining({ role: 'viewer' })
    ])
    expect(await provisionedEvents(space.id)).toEqual([
      expect.objectContaining({
        data: { space_id: space.id, resource: { kind: 'wiki', id: wiki.id } }
      })
    ])
  })

  it('makes the wiki match the space: name, roles, and who left', async () => {
    const admin = aUser()
    const leaver = aUser({ organizationId: admin.organizationId })
    const promoted = aUser({ organizationId: admin.organizationId })
    const joiner = aUser({ organizationId: admin.organizationId })
    const space = await aSpaceOf(admin, [leaver, promoted])

    await deliver('twake.space.synced', {
      ...space,
      name: 'Operations',
      members: [
        member(admin, 'admin'),
        member(promoted, 'admin'),
        member(joiner, 'viewer')
      ],
      groups: []
    })

    expect(await spaceWikis(admin)).toEqual([
      expect.objectContaining({ name: 'Operations', role: 'admin' })
    ])
    expect(await spaceWikis(leaver)).toEqual([])
    expect(await spaceWikis(promoted)).toEqual([
      expect.objectContaining({ role: 'admin' })
    ])
    expect(await spaceWikis(joiner)).toEqual([
      expect.objectContaining({ role: 'viewer' })
    ])
  })

  it('keeps a member the snapshot lists without a uuid', async () => {
    const admin = aUser()
    const editor = aUser({ organizationId: admin.organizationId })
    const space = await aSpaceOf(admin, [editor])

    await deliver('twake.space.synced', {
      ...space,
      name: 'Ops',
      members: [
        { email: admin.email, role: 'admin' },
        { email: editor.email, role: 'editor' }
      ],
      groups: []
    })

    expect(await spaceWikis(admin)).toHaveLength(1)
    expect(await spaceWikis(editor)).toHaveLength(1)
  })

  it('ignores a snapshot older than the last event of the space', async () => {
    const admin = aUser()
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')],
      timestamp: at(30)
    })

    await deliver('twake.space.synced', {
      ...space,
      name: 'Stale',
      members: [],
      groups: [],
      timestamp: at(10)
    })

    expect(await spaceWikis(admin)).toEqual([
      expect.objectContaining({ name: 'Ops', role: 'admin' })
    ])
  })

  it('leaves a deleted space deleted, and its wiki unannounced', async () => {
    const admin = aUser()
    const space = { organizationId: admin.organizationId, id: randomUUID() }
    await deliver('twake.space.created', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')],
      timestamp: at(0)
    })
    await deliver('twake.space.deleted', { ...space, timestamp: at(5) })

    await deliver('twake.space.synced', {
      ...space,
      name: 'Ops',
      members: [member(admin, 'admin')],
      groups: []
    })

    expect(await spaceWikis(admin)).toEqual([])
    expect(await provisionedEvents(space.id)).toHaveLength(1)
  })
})

describe('twake.space.sync.completed', () => {
  it('deletes the wikis of the spaces of the organization it does not list, except newer ones', async () => {
    const listedAdmin = aUser()
    const goneAdmin = aUser({ organizationId: listedAdmin.organizationId })
    const newerAdmin = aUser({ organizationId: listedAdmin.organizationId })
    const elsewhere = aUser()
    const listed = await aSpaceOf(listedAdmin)
    await aSpaceOf(goneAdmin)
    const newer = await aSpaceOf(newerAdmin)
    await aSpaceOf(elsewhere)
    await deliver('twake.space.updated', {
      ...newer,
      name: 'Newer',
      timestamp: '2999-01-01T00:00:00.000Z'
    })
    const gone = await spaceWikiOf(goneAdmin)

    await deliver('twake.space.sync.completed', {
      organizationId: listedAdmin.organizationId,
      spaceIds: [listed.id]
    })

    expect(await spaceWikis(goneAdmin)).toEqual([])
    await expect(purgeJobOf(db, gone.id)).resolves.toEqual(
      expect.objectContaining({ kind: PURGE_WIKI_JOB })
    )
    expect(await spaceWikis(listedAdmin)).toHaveLength(1)
    expect(await spaceWikis(newerAdmin)).toHaveLength(1)
    expect(await spaceWikis(elsewhere)).toHaveLength(1)
  })

  it('deletes every space wiki of an organization that has no space left', async () => {
    const admin = aUser()
    await aSpaceOf(admin)

    await deliver('twake.space.sync.completed', {
      organizationId: admin.organizationId,
      spaceIds: []
    })

    expect(await spaceWikis(admin)).toEqual([])
  })
})

describe('knowsAnySpace', () => {
  it('sees the spaces of every organization', async () => {
    await aSpaceOf(aUser())

    expect(await knowsAnySpace(db)).toBe(true)
  })
})
