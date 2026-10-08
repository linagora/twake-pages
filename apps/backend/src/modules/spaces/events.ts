import { and, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
import { z } from 'zod'
import type { OutgoingEvent, PlatformEvent } from '../../events/envelope.ts'
import { enqueue } from '../../events/outbox.ts'
import { parseOrDrop, type Handler } from '../../events/router.ts'
import { asOrganization, type Tx } from '../../infra/db.ts'
import { memberRole, wikiMembers, wikis } from '../wikis/schema.ts'
import { addHomePage, planPurge } from '../wikis/store.ts'
import { spaces } from './schema.ts'

const timestamp = z.iso.datetime({ offset: true })

const spaceEvent = z.looseObject({
  organizationId: z.string().min(1),
  id: z.uuid(),
  timestamp
})

// People are keyed by entryUUID; one sent without it waits for the next sync.
const member = z.looseObject({
  uuid: z.uuid().optional(),
  email: z.email(),
  role: z.enum(memberRole.enumValues)
})

const spaceCreated = spaceEvent.extend({
  name: z.string().min(1),
  members: z.array(member).default([])
})

const spaceUpdated = spaceEvent.extend({ name: z.string().min(1).optional() })

const membersChanged = spaceEvent.extend({ members: z.array(member).min(1) })

const person = z
  .looseObject({ uuid: z.uuid().optional(), email: z.email().optional() })
  .refine(p => p.uuid ?? p.email, 'needs a uuid or an email')

const membersRemoved = spaceEvent.extend({ members: z.array(person).min(1) })

type SpaceRef = Pick<z.infer<typeof spaceEvent>, 'organizationId' | 'id'>

/** The wiki kept for the space, deleted or not. */
async function wikiOf(tx: Tx, space: SpaceRef): Promise<string | undefined> {
  const [row] = await tx
    .select({ wikiId: spaces.wikiId })
    .from(spaces)
    .where(eq(spaces.id, space.id))
  return row?.wikiId
}

// Names are copied onto memberships at sign-in, so a new membership starts
// from one the person already has.
const knownName = (userId: string) =>
  sql<string | null>`(select ${wikiMembers.name} from ${wikiMembers}
    where ${wikiMembers.userId} = ${userId} and ${wikiMembers.name} is not null
    limit 1)`

// The people who show the wiki reload it when its version moves.
async function touch(tx: Tx, wikiId: string) {
  await tx
    .update(wikis)
    .set({ version: sql`${wikis.version} + 1` })
    .where(eq(wikis.id, wikiId))
}

async function upsertMembers(
  tx: Tx,
  space: SpaceRef,
  members: z.infer<typeof member>[]
) {
  const wikiId = await wikiOf(tx, space)
  if (!wikiId) return
  // One upsert cannot touch a row twice, so a member listed twice keeps its last entry.
  const byUser = new Map(
    members.flatMap(({ uuid, email, role }) =>
      uuid
        ? [
            [
              uuid,
              {
                wikiId,
                organizationId: space.organizationId,
                userId: uuid,
                email,
                role,
                name: knownName(uuid)
              }
            ] as const
          ]
        : []
    )
  )
  if (byUser.size === 0) return
  const changed = await tx
    .insert(wikiMembers)
    .values([...byUser.values()])
    .onConflictDoUpdate({
      target: [wikiMembers.wikiId, wikiMembers.userId],
      set: { email: sql`excluded.email`, role: sql`excluded.role` },
      setWhere: sql`(${wikiMembers.email}, ${wikiMembers.role}) is distinct from (excluded.email, excluded.role)`
    })
    .returning({ userId: wikiMembers.userId })
  if (changed.length > 0) await touch(tx, wikiId)
}

/**
 * Takes the wiki from these people. What they wrote stays, and the
 * notifications about it stop reaching them with their membership.
 */
async function removeMembers(
  tx: Tx,
  space: SpaceRef,
  which: SQL | undefined
): Promise<void> {
  const wikiId = await wikiOf(tx, space)
  if (!wikiId) return
  const removed = await tx
    .delete(wikiMembers)
    .where(and(eq(wikiMembers.wikiId, wikiId), which))
    .returning({ userId: wikiMembers.userId })
  if (removed.length > 0) await touch(tx, wikiId)
}

async function provisioned(tx: Tx, space: SpaceRef): Promise<OutgoingEvent> {
  const wikiId = await wikiOf(tx, space)
  if (!wikiId) throw new Error(`space ${space.id} has no wiki`)
  return {
    specversion: '1.0',
    id: `pages-space-provisioned-${space.id}`,
    source: 'twake://pages',
    type: 'com.twake.pages.space.provisioned.v1',
    twakeorg: space.organizationId,
    data: { space_id: space.id, resource: { kind: 'wiki', id: wikiId } }
  }
}

// The space writes the home page: no person did.
async function provisionSpace(
  tx: Tx,
  space: SpaceRef & { name: string }
): Promise<void> {
  if (await wikiOf(tx, space)) return
  const [wiki] = await tx
    .insert(wikis)
    .values({
      organizationId: space.organizationId,
      name: space.name,
      kind: 'space',
      createdBy: space.id
    })
    .returning({
      id: wikis.id,
      organizationId: wikis.organizationId,
      name: wikis.name
    })
  if (!wiki) throw new Error('wiki insert returned nothing')
  const [created] = await tx
    .insert(spaces)
    .values({
      id: space.id,
      organizationId: space.organizationId,
      wikiId: wiki.id
    })
    .onConflictDoNothing()
    .returning({ id: spaces.id })
  if (!created) {
    await tx.delete(wikis).where(eq(wikis.id, wiki.id))
    return
  }
  await addHomePage(tx, { userId: space.id, email: '', name: space.name }, wiki)
}

async function renameSpace(tx: Tx, space: SpaceRef, name: string) {
  const wikiId = await wikiOf(tx, space)
  if (!wikiId) return
  const renamed = await tx
    .update(wikis)
    .set({ name })
    .where(and(eq(wikis.id, wikiId), ne(wikis.name, name)))
    .returning({ id: wikis.id })
  if (renamed.length > 0) await touch(tx, wikiId)
}

/** Puts the space's wiki out of reach now, for the wiki purge job to take. */
async function deleteSpace(tx: Tx, space: SpaceRef): Promise<void> {
  const wikiId = await wikiOf(tx, space)
  if (!wikiId) return
  const [deleted] = await tx
    .update(wikis)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(wikis.id, wikiId), isNull(wikis.deletedAt)))
    .returning({
      id: wikis.id,
      organizationId: wikis.organizationId,
      createdBy: wikis.createdBy
    })
  if (!deleted) return
  await touch(tx, wikiId)
  await planPurge(tx, deleted)
}

export function spaceRoutes(): ReadonlyMap<string, Handler<PlatformEvent>> {
  // A replay creates nothing, and publishes the same event again.
  const onCreated: Handler<PlatformEvent> = async (event, tx) => {
    const space = parseOrDrop(spaceCreated, event.body, event.routingKey)
    await asOrganization(tx, space.organizationId)
    await provisionSpace(tx, space)
    await upsertMembers(tx, space, space.members)
    await enqueue(tx, await provisioned(tx, space))
  }

  const onUpdated: Handler<PlatformEvent> = async (event, tx) => {
    const space = parseOrDrop(spaceUpdated, event.body, event.routingKey)
    await asOrganization(tx, space.organizationId)
    if (space.name !== undefined) await renameSpace(tx, space, space.name)
  }

  const onMembersChanged: Handler<PlatformEvent> = async (event, tx) => {
    const space = parseOrDrop(membersChanged, event.body, event.routingKey)
    await asOrganization(tx, space.organizationId)
    await upsertMembers(tx, space, space.members)
  }

  const onMembersRemoved: Handler<PlatformEvent> = async (event, tx) => {
    const space = parseOrDrop(membersRemoved, event.body, event.routingKey)
    await asOrganization(tx, space.organizationId)
    const uuids = space.members.flatMap(p => (p.uuid ? [p.uuid] : []))
    const emails = space.members.flatMap(p => (p.email ? [p.email] : []))
    await removeMembers(
      tx,
      space,
      or(inArray(wikiMembers.userId, uuids), inArray(wikiMembers.email, emails))
    )
  }

  const onDeleted: Handler<PlatformEvent> = async (event, tx) => {
    const space = parseOrDrop(spaceEvent, event.body, event.routingKey)
    await asOrganization(tx, space.organizationId)
    await deleteSpace(tx, space)
  }

  return new Map([
    ['twake.space.created', onCreated],
    ['twake.space.updated', onUpdated],
    ['twake.space.deleted', onDeleted],
    ['twake.space.member.added', onMembersChanged],
    ['twake.space.member.role.changed', onMembersChanged],
    ['twake.space.member.removed', onMembersRemoved]
  ])
}
