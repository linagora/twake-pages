import { sql, type SQL } from 'drizzle-orm'
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn
} from 'drizzle-orm/pg-core'
import {
  currentUser,
  id,
  leavingUser,
  organizationId,
  tenant,
  tenantPolicy,
  timestamptz
} from '../../infra/db.ts'

export const memberRole = pgEnum('member_role', ['viewer', 'editor', 'admin'])

export const wikiKind = pgEnum('wiki_kind', ['personal', 'shared', 'space'])

// The B2C wikis of a person: those they made, and those they are a member of.
const createdOrJoined = (createdBy: AnyPgColumn, wikiId: AnyPgColumn): SQL =>
  sql`${createdBy} = ${currentUser} or ${wikiId} = any((select app_member_wiki_ids())::uuid[])`

export const wikis = pgTable.withRLS(
  'wikis',
  {
    id: id(),
    organizationId: organizationId(),
    name: text().notNull(),
    description: text().notNull().default(''),
    kind: wikiKind().notNull(),
    version: bigint({ mode: 'number' }).notNull().default(0),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    // A deleted wiki is out of reach until it is purged.
    deletedAt: timestamptz('deleted_at'),
    tenant: tenant()
  },
  table => [
    unique().on(table.tenant, table.id),
    // Row level security splits a person's wikis by organization, B2C included.
    uniqueIndex('wikis_one_personal_per_user')
      .on(sql`coalesce(${table.organizationId}, '')`, table.createdBy)
      .where(sql`${table.kind} = 'personal'`),
    // A B2C person sees a wiki once a member only, but app_claim_invites locks
    // the wikis whose invitations it claims first: it names them in
    // app.claimed_wikis, which shows them in USING only (see its migration).
    tenantPolicy(
      table.organizationId,
      sql`${createdOrJoined(table.createdBy, table.id)} or ${table.id} = any((select nullif(current_setting('app.claimed_wikis', true), ''))::uuid[])`,
      createdOrJoined(table.createdBy, table.id)
    )
  ]
)

// The wikis policy applies inside the subquery: a B2C row is visible when its wiki is.
export const visibleWiki = (wikiId: AnyPgColumn): SQL =>
  sql`exists (select 1 from ${wikis} where ${wikis.id} = ${wikiId})`

export const wikiMembers = pgTable.withRLS(
  'wiki_members',
  {
    wikiId: uuid('wiki_id')
      .notNull()
      .references(() => wikis.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    userId: uuid('user_id').notNull(),
    email: text().notNull(),
    // From the person's last sign-in: null for someone who never signed in.
    name: text(),
    role: memberRole().notNull(),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
    tenant: tenant()
  },
  table => [
    primaryKey({ columns: [table.wikiId, table.userId] }),
    index().on(table.userId),
    foreignKey({
      columns: [table.tenant, table.wikiId],
      foreignColumns: [wikis.tenant, wikis.id]
    }),
    // The flag is on while app_member_wiki_ids reads this table (see its migration).
    tenantPolicy(
      table.organizationId,
      sql`current_setting('app.membership_lookup', true) = 'on' or ${visibleWiki(table.wikiId)}`
    )
  ]
)

// An invite waits for its email to sign in, then app_claim_invites turns it
// into a membership. The organization keeps it inside its tenant.
export const wikiInvites = pgTable.withRLS(
  'wiki_invites',
  {
    id: id(),
    wikiId: uuid('wiki_id')
      .notNull()
      .references(() => wikis.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    email: text().notNull(),
    role: memberRole().notNull(),
    invitedBy: uuid('invited_by').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    tenant: tenant()
  },
  table => [
    unique().on(table.wikiId, table.email),
    index().on(table.email),
    foreignKey({
      columns: [table.tenant, table.wikiId],
      foreignColumns: [wikis.tenant, wikis.id]
    }),
    check(
      'wiki_invites_email_lower',
      sql`${table.email} = lower(${table.email})`
    ),
    // The person's email lets them read and claim their invites, but not write
    // one, unlike in Twake Tasks: they could invite themselves to any B2C wiki.
    tenantPolicy(
      table.organizationId,
      sql`${visibleWiki(table.wikiId)} or ${table.email} = lower(current_setting('app.user_email', true))`,
      visibleWiki(table.wikiId)
    )
  ]
)

// Every invitation email scheduled, to limit them as Twake Tasks does: an
// invitation can be canceled and made again, and the job queue forgets a job
// once it ran.
export const inviteEmails = pgTable.withRLS(
  'invite_emails',
  {
    id: id(),
    wikiId: uuid('wiki_id')
      .notNull()
      .references(() => wikis.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    email: text().notNull(),
    invitedBy: uuid('invited_by').notNull(),
    sentAt: timestamptz('sent_at').notNull().defaultNow(),
    tenant: tenant()
  },
  table => [
    index().on(table.wikiId, table.email, table.sentAt),
    index().on(table.invitedBy, table.sentAt),
    foreignKey({
      columns: [table.tenant, table.wikiId],
      foreignColumns: [wikis.tenant, wikis.id]
    }),
    // In USING, the rows app_forget_user deletes for a deleted account: those
    // it sent, or that hold one of its emails, which in B2C may be of wikis it
    // left or never joined (see its migration).
    tenantPolicy(
      table.organizationId,
      sql`${visibleWiki(table.wikiId)} or ${table.invitedBy} = ${leavingUser} or ${table.email} in (select lower(${wikiMembers.email}) from ${wikiMembers} where ${wikiMembers.userId} = ${leavingUser})`,
      visibleWiki(table.wikiId)
    )
  ]
)
