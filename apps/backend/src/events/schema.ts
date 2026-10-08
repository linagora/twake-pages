import {
  bigint,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text
} from 'drizzle-orm/pg-core'
import { timestamptz } from '../infra/db.ts'

// Read by the relay across organizations, so outside row level security.
export const outbox = pgTable(
  'outbox',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    event: jsonb().notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    sentAt: timestamptz('sent_at')
  },
  table => [index().on(table.sentAt, table.id)]
)

export const processedEvents = pgTable(
  'processed_events',
  {
    consumer: text().notNull(),
    source: text().notNull(),
    id: text().notNull(),
    processedAt: timestamptz('processed_at').notNull().defaultNow()
  },
  table => [primaryKey({ columns: [table.consumer, table.source, table.id] })]
)
