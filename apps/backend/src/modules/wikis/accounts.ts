import { and, asc, eq, inArray, isNull, ne, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { PlatformEvent } from '../../events/envelope.ts'
import {
  parseOrDrop,
  RejectedEventError,
  type Handler
} from '../../events/router.ts'
import { asOrganization, asTenant, type Tx } from '../../infra/db.ts'
import { jobs } from '../../scheduler/schema.ts'
import { userSettings } from '../settings/schema.ts'
import { bumpWiki } from './live.ts'
import { wikiMembers, wikis } from './schema.ts'

// ldap-rest names B2B users by email until it sends their entryUUID.
const b2bDeleted = z.looseObject({
  organizationId: z.string().min(1).optional(),
  uuid: z.uuid().optional(),
  internalEmail: z.email().optional()
})

const organizationDeleted = z.looseObject({
  organizationId: z.string().min(1).optional()
})

const b2cDeleted = z.looseObject({
  uuid: z.uuid().optional(),
  internalEmail: z.email().optional()
})

// A B2C membership is visible only to its own member, so finding one by email
// takes the lookup flag the membership policy honours. Goes once ldap-rest
// sends the uuid in user.deleted.
async function b2cUserIdByEmail(tx: Tx, email: string) {
  await asOrganization(tx, null)
  await tx.execute(sql`select set_config('app.membership_lookup', 'on', true)`)
  const userId = await userIdByEmail(tx, email)
  await tx.execute(sql`select set_config('app.membership_lookup', '', true)`)
  return userId
}

// Unlike Twake Tasks, which compares emails as they are: a membership keeps
// the email as the person's sign-in gave it, in a case ldap-rest may not
// share. Invitations and settings are matched lowercased too.
async function userIdByEmail(tx: Tx, email: string) {
  const [member] = await tx
    .select({ userId: wikiMembers.userId })
    .from(wikiMembers)
    .where(sql`lower(${wikiMembers.email}) = lower(${email})`)
    .limit(1)
  return member?.userId
}

// A wiki whose only admin leaves goes to its oldest editor, or is deleted.
// A space wiki's members come from its space, so it is left alone. Unlike
// Twake Tasks, which hands on or deletes a deleted project as any other, a
// wiki already deleted is left to its purge, 30 days after its deletion.
async function handOnWikis(tx: Tx, userId: string) {
  const otherAdmin = alias(wikiMembers, 'other_admin')
  const orphaned = await tx
    .select({ wikiId: wikiMembers.wikiId })
    .from(wikiMembers)
    .innerJoin(wikis, eq(wikis.id, wikiMembers.wikiId))
    .where(
      and(
        eq(wikiMembers.userId, userId),
        eq(wikiMembers.role, 'admin'),
        eq(wikis.kind, 'shared'),
        isNull(wikis.deletedAt),
        notExists(
          tx
            .select()
            .from(otherAdmin)
            .where(
              and(
                eq(otherAdmin.wikiId, wikiMembers.wikiId),
                eq(otherAdmin.role, 'admin'),
                ne(otherAdmin.userId, userId)
              )
            )
        )
      )
    )
  for (const { wikiId } of orphaned) {
    const [editor] = await tx
      .select({ userId: wikiMembers.userId })
      .from(wikiMembers)
      .where(
        and(eq(wikiMembers.wikiId, wikiId), eq(wikiMembers.role, 'editor'))
      )
      .orderBy(asc(wikiMembers.joinedAt))
      .limit(1)
    if (editor) {
      await tx
        .update(wikiMembers)
        .set({ role: 'admin' })
        .where(
          and(
            eq(wikiMembers.wikiId, wikiId),
            eq(wikiMembers.userId, editor.userId)
          )
        )
    } else {
      await tx.delete(wikis).where(eq(wikis.id, wikiId))
    }
  }
}

// Unlike Twake Tasks, which moves no version here: a wiki's version moves with
// its members, so the people showing a wiki the person leaves reload it. The
// versions move first, wiki by wiki in a fixed order, so their row locks make
// the changes to those wikis meanwhile wait, without a deadlock. A deleted
// wiki is shown to no one, so its version stays.
async function bumpWikisOf(tx: Tx, userId: string) {
  const left = await tx
    .select({ wikiId: wikiMembers.wikiId })
    .from(wikiMembers)
    .innerJoin(wikis, eq(wikis.id, wikiMembers.wikiId))
    .where(and(eq(wikiMembers.userId, userId), isNull(wikis.deletedAt)))
    .orderBy(asc(wikiMembers.wikiId))
  for (const { wikiId } of left) await bumpWiki(tx, wikiId)
}

// Runs as the person, so a B2C tenant shows the wikis they belong to; their
// memberships go last, since they are what makes those wikis visible. The
// wikis it deletes go for good, as Twake Tasks deletes the projects of a
// deleted account, rather than for the 30 days a wiki its admin deletes is kept.
async function forget(tx: Tx, organizationId: string | null, userId: string) {
  await asTenant(tx, { organizationId, userId, email: '' })
  // First: a removal from one of the person's wikis, or an invitation to it,
  // locks it before it deletes rows this deletes too.
  await bumpWikisOf(tx, userId)
  await tx.delete(userSettings).where(
    inArray(
      userSettings.email,
      tx
        .select({ email: sql<string>`lower(${wikiMembers.email})` })
        .from(wikiMembers)
        .where(eq(wikiMembers.userId, userId))
    )
  )
  // Their favorites, visits, follows and notifications, and the invitation
  // emails they sent or received, those of the wikis a B2C tenant hides from
  // them too: wikis they left, or were invited to and never joined. Unlike
  // Twake Tasks, which keeps the follows and notifications, and deletes the
  // invitation emails as the tenant, leaving those of hidden projects: the
  // follows and notifications serve only the person, as their favorites do.
  // The notifications their changes sent to others are those others', and
  // stay.
  await tx.execute(sql`select app_forget_user(${userId}::uuid)`)
  await tx
    .delete(wikis)
    .where(and(eq(wikis.createdBy, userId), eq(wikis.kind, 'personal')))
  await handOnWikis(tx, userId)
  await tx.delete(wikiMembers).where(eq(wikiMembers.userId, userId))
}

// Unlike Twake Tasks, which finds the settings by the person's memberships
// only: settings are kept for everyone Twake Workplace sends them for, so the
// email the event names also finds those of a person who never opened Pages.
async function forgetSettingsOf(tx: Tx, email: string) {
  await tx
    .delete(userSettings)
    .where(eq(userSettings.email, sql`lower(${email})`))
}

const onB2bDeleted: Handler<PlatformEvent> = async (event, tx) => {
  const account = parseOrDrop(b2bDeleted, event.body, event.routingKey)
  if (!account.organizationId) {
    throw new RejectedEventError('no organizationId')
  }
  if (!account.uuid && !account.internalEmail) {
    throw new RejectedEventError('no uuid or internalEmail')
  }
  await asOrganization(tx, account.organizationId)
  const userId =
    account.uuid ??
    (account.internalEmail
      ? await userIdByEmail(tx, account.internalEmail)
      : undefined)
  if (userId) await forget(tx, account.organizationId, userId)
  if (account.internalEmail) await forgetSettingsOf(tx, account.internalEmail)
}

const onB2cDeleted: Handler<PlatformEvent> = async (event, tx) => {
  const account = parseOrDrop(b2cDeleted, event.body, event.routingKey)
  if (!account.uuid && !account.internalEmail) {
    throw new RejectedEventError('no uuid or internalEmail')
  }
  const userId =
    account.uuid ??
    (account.internalEmail
      ? await b2cUserIdByEmail(tx, account.internalEmail)
      : undefined)
  if (userId) await forget(tx, null, userId)
  if (account.internalEmail) await forgetSettingsOf(tx, account.internalEmail)
}

// Arrives after every member's domain.user.deleted, and may be replayed.
// Everything the organization holds hangs off its wikis and goes with them by
// cascade, which row level security does not hold back, so unlike Twake Tasks
// it needs no flag to erase the rows each person alone may see.
const onOrganizationDeleted: Handler<PlatformEvent> = async (event, tx) => {
  const { organizationId } = parseOrDrop(
    organizationDeleted,
    event.body,
    event.routingKey
  )
  if (!organizationId) throw new RejectedEventError('no organizationId')
  await asOrganization(tx, organizationId)
  await tx.delete(wikis)
  await tx
    .delete(jobs)
    .where(sql`${jobs.payload}->>'organizationId' = ${organizationId}`)
}

export const accountRoutes: ReadonlyMap<
  string,
  Handler<PlatformEvent>
> = new Map([
  ['domain.user.deleted', onB2bDeleted],
  ['user.deleted', onB2cDeleted],
  ['domain.organization.deleted', onOrganizationDeleted]
])
