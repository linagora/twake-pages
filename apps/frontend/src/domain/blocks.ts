/** An object of the blocks as sent, such as a block or its props, unchecked. */
export type Fields = Record<string, unknown>

export const isFields = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isList = (value: unknown): value is unknown[] =>
  Array.isArray(value)
