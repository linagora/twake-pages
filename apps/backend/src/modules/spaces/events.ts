import {
  and,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL
} from 'drizzle-orm'
import { z } from 'zod'
import type { OutgoingEvent, PlatformEvent } from '../../events/envelope.ts'
import { enqueue } from '../../events/outbox.ts'
import { parseOrDrop, type Handler } from '../../events/router.ts'
import { asOrganization, type Db, type Tx } from '../../infra/db.ts'
import { bumpWiki } from '../wikis/live.ts'
import { takeOutOfWiki } from '../wikis/members.ts'
import { memberRole, wikiMembers, wikis } from '../wikis/schema.ts'
import { addHomePage, putOutOfReach } from '../wikis/store.ts'
import { spaces } from './schema.ts'

const timestamp = z.iso.datetime({ offset: true })

const spaceEvent = z.looseObject({
  organizationId: z.string().min(1),
  id: z.uuid(),
  timestamp
})

// People are keyed by entryUUID, which ADR 002 has ldap-rest send in every
// event that names a user; a member sent without it is skipped.
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

const syncCompleted = z.looseObject({
  organizationId: z.string().min(1),
  spaceIds: z.array(z.uuid()),
  timestamp
})

type SpaceRef = Pick<z.infer<typeof spaceEvent>, 'organizationId' | 'id'>
type TimedSpace = SpaceRef & { timestamp: string }

// A late or redelivered event must not undo a newer one; equal timestamps
// apply in the order they arrive.
async function isStale(tx: Tx, space: TimedSpace): Promise<boolean> {
  const [row] = await tx
    .select({
      stale: sql<boolean>`${spaces.lastEventAt} > ${space.timestamp}::timestamptz`
    })
    .from(spaces)
    .where(eq(spaces.id, space.id))
  return row?.stale === true
}

async function applied(tx: Tx, space: TimedSpace) {
  await tx
    .update(spaces)
    .set({
      lastEventAt: sql`greatest(${spaces.lastEventAt}, ${space.timestamp}::timestamptz)`
    })
    .where(eq(spaces.id, space.id))
}

/** Whether any organization has a space, deleted or not. */
export async function knowsAnySpace(db: Db): Promise<boolean> {
  return db.transaction(async tx => {
    await tx.execute(sql`select set_config('app.space_lookup', 'on', true)`)
    const [row] = await tx.select({ id: spaces.id }).from(spaces).limit(1)
    return row !== undefined
  })
}

/** The wiki kept for the space, deleted or not. */
async function wikiOf(tx: Tx, space: SpaceRef): Promise<string | undefined> {
  const [row] = await tx
    .select({ wikiId: spaces.wikiId })
    .from(spaces)
    .where(eq(spaces.id, space.id))
  return row?.wikiId
}

/**
 * The space's wiki, unless deleted. Unlike Twake Tasks, the later events of a
 * space leave its deleted wiki as it was: no one reaches it again.
 */
async function liveWikiOf(
  tx: Tx,
  space: SpaceRef
): Promise<string | undefined> {
  const [row] = await tx
    .select({ wikiId: spaces.wikiId })
    .from(spaces)
    .innerJoin(wikis, eq(wikis.id, spaces.wikiId))
    .where(and(eq(spaces.id, space.id), isNull(wikis.deletedAt)))
  return row?.wikiId
}

// Names are copied onto memberships at sign-in, so a new membership starts
// from one the person already has.
const knownName = (userId: string) =>
  sql<string | null>`(select ${wikiMembers.name} from ${wikiMembers}
    where ${wikiMembers.userId} = ${userId} and ${wikiMembers.name} is not null
    limit 1)`

async function upsertMembers(
  tx: Tx,
  space: SpaceRef,
  members: z.infer<typeof member>[]
) {
  const wikiId = await liveWikiOf(tx, space)
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
  if (changed.length > 0) await bumpWiki(tx, wikiId)
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

// The first admin with a uuid writes the home page, as ADR 005 takes the
// space's first admin for a calendar's domain; the space does when the event
// names none. The wiki's creator, which no route shows, stays the space.
async function provisionSpace(
  tx: Tx,
  space: SpaceRef & { name: string; members: z.infer<typeof member>[] }
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
  const admin = space.members.find(m => m.role === 'admin' && m.uuid)
  const author = admin?.uuid
    ? { userId: admin.uuid, email: admin.email, name: null }
    : { userId: space.id, email: '', name: space.name }
  await addHomePage(tx, author, wiki, admin?.uuid ?? null)
}

async function renameSpace(tx: Tx, space: SpaceRef, name: string) {
  const wikiId = await liveWikiOf(tx, space)
  if (!wikiId) return
  const renamed = await tx
    .update(wikis)
    .set({ name })
    .where(and(eq(wikis.id, wikiId), ne(wikis.name, name)))
    .returning({ id: wikis.id })
  if (renamed.length > 0) await bumpWiki(tx, wikiId)
}

/**
 * Takes the wiki from these people, as its admin would: their favorites and
 * visits of its pages go, what they wrote stays, and the notifications about
 * it stop reaching them with their membership.
 */
async function removeMembers(
  tx: Tx,
  space: SpaceRef,
  which: SQL | undefined
): Promise<void> {
  const wikiId = await liveWikiOf(tx, space)
  if (!wikiId) return
  const leaving = await tx
    .select({ userId: wikiMembers.userId })
    .from(wikiMembers)
    .where(and(eq(wikiMembers.wikiId, wikiId), which))
  if (leaving.length === 0) return
  await bumpWiki(tx, wikiId)
  await takeOutOfWiki(
    tx,
    wikiId,
    leaving.map(member => member.userId)
  )
}

/** Puts the space's wiki out of reach now, for the wiki purge job to take. */
async function deleteSpace(tx: Tx, space: SpaceRef): Promise<void> {
  const wikiId = await liveWikiOf(tx, space)
  if (wikiId) await putOutOfReach(tx, wikiId)
}

/**
 * Makes the space's wiki match the whole space, creating it if missing.
 * A deleted space stays deleted, since space ids are never reused.
 */
async function matchSpace(
  tx: Tx,
  space: SpaceRef & { name: string; members: z.infer<typeof member>[] }
): Promise<void> {
  const wikiId = await wikiOf(tx, space)
  if (wikiId) {
    const [wiki] = await tx
      .select({ deletedAt: wikis.deletedAt })
      .from(wikis)
      .where(eq(wikis.id, wikiId))
    if (wiki?.deletedAt) return
  }
  await provisionSpace(tx, space)
  // Every time, so TwakeSpace learns the wiki even if an earlier event was
  // lost; it ignores the repeats, which share the event id.
  await enqueue(tx, await provisioned(tx, space))
  await renameSpace(tx, space, space.name)
  await upsertMembers(tx, space, space.members)
  const uuids = space.members.flatMap(m => (m.uuid ? [m.uuid] : []))
  await removeMembers(
    tx,
    space,
    and(
      notInArray(wikiMembers.userId, uuids),
      notInArray(
        wikiMembers.email,
        space.members.map(m => m.email)
      )
    )
  )
}

function inOrder<S extends z.ZodType<TimedSpace>>(
  schema: S,
  apply: (tx: Tx, space: z.output<S>) => Promise<void>
): Handler<PlatformEvent> {
  return async (event, tx) => {
    const space = parseOrDrop(schema, event.body, event.routingKey)
    await asOrganization(tx, space.organizationId)
    if (await isStale(tx, space)) return
    await apply(tx, space)
    await applied(tx, space)
  }
}

export function spaceRoutes(): ReadonlyMap<string, Handler<PlatformEvent>> {
  // A replay creates nothing, and publishes the same event again.
  const onCreated: Handler<PlatformEvent> = async (event, tx) => {
    const space = parseOrDrop(spaceCreated, event.body, event.routingKey)
    await asOrganization(tx, space.organizationId)
    const stale = await isStale(tx, space)
    await provisionSpace(tx, space)
    if (!stale) {
      await upsertMembers(tx, space, space.members)
      await applied(tx, space)
    }
    await enqueue(tx, await provisioned(tx, space))
  }

  const onUpdated = inOrder(spaceUpdated, async (tx, space) => {
    if (space.name !== undefined) await renameSpace(tx, space, space.name)
  })

  const onMembersChanged = inOrder(membersChanged, (tx, space) =>
    upsertMembers(tx, space, space.members)
  )

  const onMembersRemoved = inOrder(membersRemoved, async (tx, space) => {
    const uuids = space.members.flatMap(p => (p.uuid ? [p.uuid] : []))
    const emails = space.members.flatMap(p => (p.email ? [p.email] : []))
    await removeMembers(
      tx,
      space,
      or(inArray(wikiMembers.userId, uuids), inArray(wikiMembers.email, emails))
    )
  })

  const onSynced = inOrder(spaceCreated, matchSpace)

  // Applied whatever its timestamp, since a space id is never reused.
  const onDeleted: Handler<PlatformEvent> = async (event, tx) => {
    const space = parseOrDrop(spaceEvent, event.body, event.routingKey)
    await asOrganization(tx, space.organizationId)
    await deleteSpace(tx, space)
    await applied(tx, space)
  }

  // A space with an event newer than the snapshot may be missing from it.
  const onSyncCompleted: Handler<PlatformEvent> = async (event, tx) => {
    const sync = parseOrDrop(syncCompleted, event.body, event.routingKey)
    await asOrganization(tx, sync.organizationId)
    const gone = await tx
      .select({ id: spaces.id })
      .from(spaces)
      .innerJoin(wikis, eq(wikis.id, spaces.wikiId))
      .where(
        and(
          eq(spaces.organizationId, sync.organizationId),
          isNull(wikis.deletedAt),
          notInArray(spaces.id, sync.spaceIds),
          or(
            isNull(spaces.lastEventAt),
            lte(spaces.lastEventAt, sql`${sync.timestamp}::timestamptz`)
          )
        )
      )
    for (const { id } of gone) {
      await deleteSpace(tx, { organizationId: sync.organizationId, id })
    }
  }

  return new Map([
    ['twake.space.created', onCreated],
    ['twake.space.updated', onUpdated],
    ['twake.space.deleted', onDeleted],
    ['twake.space.member.added', onMembersChanged],
    ['twake.space.member.role.changed', onMembersChanged],
    ['twake.space.member.removed', onMembersRemoved],
    ['twake.space.synced', onSynced],
    ['twake.space.sync.completed', onSyncCompleted]
  ])
}
