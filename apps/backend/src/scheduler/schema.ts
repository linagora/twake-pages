import { sql } from 'drizzle-orm'
import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { timestamptz } from '../infra/db.ts'

// Read by the scheduler across organizations, so outside row level security.
// A handler runs its work as the tenant its payload names.
export const jobs = pgTable(
  'jobs',
  {
    id: uuid()
      .primaryKey()
      .default(sql`uuidv7()`),
    kind: text().notNull(),
    key: text().unique(),
    payload: jsonb().notNull(),
    runAt: timestamptz('run_at').notNull(),
    attempts: integer().notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamptz('created_at').notNull().defaultNow()
  },
  table => [index().on(table.runAt)]
)
