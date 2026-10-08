import {
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid
} from 'drizzle-orm/pg-core'
import {
  id,
  organizationId,
  tenant,
  tenantPolicy,
  timestamptz
} from '../../infra/db.ts'
import { pages, visiblePage } from '../pages/schema.ts'

export const comments = pgTable.withRLS(
  'comments',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    // A reply, on the page of the comment it answers.
    parentId: uuid('parent_id'),
    organizationId: organizationId(),
    authorId: uuid('author_id').notNull(),
    authorEmail: text('author_email').notNull(),
    authorName: text('author_name'),
    body: text().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    editedAt: timestamptz('edited_at'),
    tenant: tenant()
  },
  table => [
    unique().on(table.pageId, table.id),
    index().on(table.pageId, table.createdAt),
    foreignKey({
      columns: [table.pageId, table.parentId],
      foreignColumns: [table.pageId, table.id]
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.tenant, table.pageId],
      foreignColumns: [pages.tenant, pages.id]
    }),
    tenantPolicy(table.organizationId, visiblePage(table.pageId))
  ]
)
