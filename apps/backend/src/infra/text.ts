/**
 * Whether the text reaches the database as sent. PostgreSQL refuses a NUL
 * character in text and in jsonb, and a lone surrogate, which JSON can carry,
 * in jsonb; in text, a lone surrogate would arrive as U+FFFD.
 */
export const storable = (text: string) =>
  !text.includes('\u0000') && text.isWellFormed()
