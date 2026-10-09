/** `items` as a sentence of `lang` lists them, such as "a, b and c". */
export const listed = (items: readonly string[], lang: string): string =>
  new Intl.ListFormat(lang, { type: 'conjunction' }).format(items)
