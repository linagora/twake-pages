import { sql, type SQL } from 'drizzle-orm'
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
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
  sortKey,
  tenant,
  tenantPolicy,
  timestamptz
} from '../../infra/db.ts'
import { visibleWiki, wikis } from '../wikis/schema.ts'

export const pageKind = pgEnum('page_kind', ['document', 'database'])

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' })

// pages_position, unique among the live pages of a parent, is in the
// migration: drizzle cannot write its nulls not distinct.
export const pages = pgTable.withRLS(
  'pages',
  {
    id: id(),
    wikiId: uuid('wiki_id')
      .notNull()
      .references(() => wikis.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    parentId: uuid('parent_id'),
    home: boolean().notNull().default(false),
    kind: pageKind().notNull(),
    title: text().notNull(),
    content: jsonb().notNull().default([]),
    gristUrl: text('grist_url'),
    text: text().notNull().default(''),
    search: tsvector()
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('simple', "title"), 'A') || setweight(to_tsvector('simple', "text"), 'B')`
      ),
    version: integer().notNull().default(1),
    // The home page is outside the tree, so it alone has no position.
    position: sortKey(),
    createdBy: uuid('created_by').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').notNull(),
    updatedAt: timestamptz('updated_at').notNull().defaultNow(),
    deletedAt: timestamptz('deleted_at'),
    deletedBy: uuid('deleted_by'),
    // The root of the branch the page went to the trash with, itself for the root.
    trashRootId: uuid('trash_root_id'),
    tenant: tenant()
  },
  table => [
    unique().on(table.tenant, table.id),
    unique().on(table.wikiId, table.id),
    uniqueIndex('pages_one_home_per_wiki')
      .on(table.wikiId)
      .where(sql`${table.home}`),
    index().on(table.wikiId, table.parentId),
    index().using('gin', table.search),
    foreignKey({
      columns: [table.wikiId, table.parentId],
      foreignColumns: [table.wikiId, table.id]
    }),
    foreignKey({
      columns: [table.tenant, table.wikiId],
      foreignColumns: [wikis.tenant, wikis.id]
    }),
    check(
      'pages_home_document',
      sql`not ${table.home} or (${table.parentId} is null and ${table.kind} = 'document')`
    ),
    check(
      'pages_home_outside_tree',
      sql`${table.home} = (${table.position} is null)`
    ),
    check(
      'pages_database_grist_url',
      sql`(${table.kind} = 'database') = (${table.gristUrl} is not null)`
    ),
    check(
      'pages_trash_root',
      sql`(${table.deletedAt} is null) = (${table.trashRootId} is null)`
    ),
    check(
      'pages_home_not_deleted',
      sql`not (${table.home} and ${table.deletedAt} is not null)`
    ),
    tenantPolicy(table.organizationId, visibleWiki(table.wikiId))
  ]
)

// The pages policy applies inside the subquery: a B2C row is visible when its page is.
export const visiblePage = (pageId: AnyPgColumn): SQL =>
  sql`exists (select 1 from ${pages} where ${pages.id} = ${pageId})`

export const pageVersions = pgTable.withRLS(
  'page_versions',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    number: integer().notNull(),
    title: text().notNull(),
    content: jsonb().notNull().default([]),
    gristUrl: text('grist_url'),
    text: text().notNull().default(''),
    authorId: uuid('author_id').notNull(),
    authorEmail: text('author_email').notNull(),
    authorName: text('author_name'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    restoredFrom: integer('restored_from'),
    tenant: tenant()
  },
  table => [
    unique().on(table.pageId, table.number),
    foreignKey({
      columns: [table.tenant, table.pageId],
      foreignColumns: [pages.tenant, pages.id]
    }),
    tenantPolicy(table.organizationId, visiblePage(table.pageId))
  ]
)

export const labels = pgTable.withRLS(
  'labels',
  {
    id: id(),
    wikiId: uuid('wiki_id')
      .notNull()
      .references(() => wikis.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    name: text().notNull(),
    tenant: tenant()
  },
  table => [
    unique().on(table.tenant, table.id),
    unique().on(table.wikiId, table.name),
    foreignKey({
      columns: [table.tenant, table.wikiId],
      foreignColumns: [wikis.tenant, wikis.id]
    }),
    tenantPolicy(table.organizationId, visibleWiki(table.wikiId))
  ]
)

export const pageLabels = pgTable.withRLS(
  'page_labels',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    tenant: tenant()
  },
  table => [
    primaryKey({ columns: [table.pageId, table.labelId] }),
    foreignKey({
      columns: [table.tenant, table.pageId],
      foreignColumns: [pages.tenant, pages.id]
    }),
    foreignKey({
      columns: [table.tenant, table.labelId],
      foreignColumns: [labels.tenant, labels.id]
    }),
    tenantPolicy(table.organizationId, visiblePage(table.pageId))
  ]
)

function ownRows(userId: AnyPgColumn) {
  const own = sql`${userId} = ${currentUser}`
  return pgPolicy('own', { as: 'restrictive', using: own, withCheck: own })
}

export const pageFavorites = pgTable.withRLS(
  'page_favorites',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    userId: uuid('user_id').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    tenant: tenant()
  },
  table => [
    primaryKey({ columns: [table.userId, table.pageId] }),
    foreignKey({
      columns: [table.tenant, table.pageId],
      foreignColumns: [pages.tenant, pages.id]
    }),
    tenantPolicy(table.organizationId, visiblePage(table.pageId)),
    ownRows(table.userId)
  ]
)

export const pageVisits = pgTable.withRLS(
  'page_visits',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    userId: uuid('user_id').notNull(),
    visitedAt: timestamptz('visited_at').notNull().defaultNow(),
    tenant: tenant()
  },
  table => [
    primaryKey({ columns: [table.userId, table.pageId] }),
    foreignKey({
      columns: [table.tenant, table.pageId],
      foreignColumns: [pages.tenant, pages.id]
    }),
    tenantPolicy(table.organizationId, visiblePage(table.pageId)),
    ownRows(table.userId)
  ]
)
