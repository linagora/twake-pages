/**
 * The path to a page from a screen of its wiki, which keeps to the frame of
 * TwakeSpace, where the wiki's address would leave it. The home page shows
 * under the name of its wiki.
 */
export const pathInItsWiki = (page: { id: string }, home: boolean): string =>
  home ? '..' : `../pages/${page.id}`
