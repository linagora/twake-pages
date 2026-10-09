import { sql, type SQL } from 'drizzle-orm'
import {
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
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
import { comments } from '../comments/schema.ts'
import { pages, visiblePage } from '../pages/schema.ts'

// A person keeps their follows and notifications of a wiki they leave, which
// in B2C its pages then hide even from them: app_forget_user reaches them
// under app.leaving_user, in USING only (see its migration).
const visibleOrLeaving = (pageId: AnyPgColumn, userId: AnyPgColumn): SQL =>
  sql`${visiblePage(pageId)} or ${userId} = ${leavingUser}`

export const pageFollowers = pgTable.withRLS(
  'page_followers',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    userId: uuid('user_id').notNull(),
    tenant: tenant()
  },
  table => [
    primaryKey({ columns: [table.pageId, table.userId] }),
    foreignKey({
      columns: [table.tenant, table.pageId],
      foreignColumns: [pages.tenant, pages.id]
    }),
    tenantPolicy(
      table.organizationId,
      visibleOrLeaving(table.pageId, table.userId),
      visiblePage(table.pageId)
    )
  ]
)

export const NOTIFICATION_REASONS = [
  'published',
  'commented',
  'mentioned'
] as const

export const notifications = pgTable.withRLS(
  'notifications',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    // The page's, for the unread count of each wiki.
    wikiId: uuid('wiki_id').notNull(),
    organizationId: organizationId(),
    userId: uuid('user_id').notNull(),
    reason: text({ enum: NOTIFICATION_REASONS }).notNull(),
    actorId: uuid('actor_id').notNull(),
    actorEmail: text('actor_email').notNull(),
    actorName: text('actor_name'),
    version: integer(),
    commentId: uuid('comment_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    readAt: timestamptz('read_at'),
    tenant: tenant()
  },
  table => [
    index().on(table.userId, table.createdAt),
    index()
      .on(table.userId, table.wikiId)
      .where(sql`${table.readAt} is null`),
    foreignKey({
      columns: [table.wikiId, table.pageId],
      foreignColumns: [pages.wikiId, pages.id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.pageId, table.commentId],
      foreignColumns: [comments.pageId, comments.id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenant, table.pageId],
      foreignColumns: [pages.tenant, pages.id]
    }),
    tenantPolicy(
      table.organizationId,
      visibleOrLeaving(table.pageId, table.userId),
      visiblePage(table.pageId)
    ),
    // Anyone who sees the page may notify someone of a change to it.
    ...(['select', 'update', 'delete'] as const).map(command =>
      pgPolicy(`own_${command}`, {
        as: 'restrictive',
        for: command,
        using: sql`${table.userId} = ${currentUser}`
      })
    )
  ]
)
