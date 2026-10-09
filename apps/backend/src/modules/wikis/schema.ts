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
  organizationId,
  tenant,
  tenantPolicy,
  timestamptz
} from '../../infra/db.ts'

export const memberRole = pgEnum('member_role', ['viewer', 'editor', 'admin'])

export const wikiKind = pgEnum('wiki_kind', ['personal', 'shared', 'space'])

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
    tenantPolicy(
      table.organizationId,
      sql`${table.createdBy} = ${currentUser} or ${table.id} = any((select app_member_wiki_ids())::uuid[])`
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
    tenantPolicy(table.organizationId, visibleWiki(table.wikiId))
  ]
)
