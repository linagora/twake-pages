import { integer, pgEnum, pgTable, text } from 'drizzle-orm/pg-core'

export const theme = pgEnum('theme', ['light', 'dark', 'auto'])

// A person's Twake Workplace settings follow them across organizations, so
// they sit outside row level security, keyed by email as common settings is.
export const userSettings = pgTable('user_settings', {
  email: text().primaryKey(),
  version: integer().notNull(),
  language: text(),
  timezone: text(),
  theme: theme(),
  avatar: text(),
  name: text()
})
