import { sql } from 'drizzle-orm'
import {
  foreignKey,
  pgPolicy,
  pgTable,
  unique,
  uuid
} from 'drizzle-orm/pg-core'
import { organizationId, tenantPolicy, timestamptz } from '../../infra/db.ts'
import { wikis } from '../wikis/schema.ts'

// The space integration's own table: the wiki it keeps for each space.
export const spaces = pgTable.withRLS(
  'spaces',
  {
    id: uuid().primaryKey(),
    organizationId: organizationId().notNull(),
    wikiId: uuid('wiki_id').notNull(),
    lastEventAt: timestamptz('last_event_at')
  },
  table => [
    unique().on(table.wikiId),
    foreignKey({
      columns: [table.organizationId, table.wikiId],
      foreignColumns: [wikis.tenant, wikis.id]
    }).onDelete('cascade'),
    tenantPolicy(table.organizationId),
    // Lets the startup check see whether any organization has a space.
    pgPolicy('space_lookup', {
      for: 'select',
      using: sql`current_setting('app.space_lookup', true) = 'on'`
    })
  ]
)
