import type { TreePage } from '@/domain/page'
import type { Wiki, WikiSummary } from '@/domain/wiki'

/** The person's Twake Workplace settings; null where they never chose. */
export interface UserSettings {
  version: number
  language: string | null
  timezone: string | null
  theme: 'light' | 'dark' | 'auto'
  avatar: string | null
  name: string | null
}

/** Name: 1 to 100 characters; description: at most 500. Both trimmed. */
export interface NewWiki {
  name: string
  description?: string
}

export interface WikiChanges {
  name?: string
  description?: string
}

/** A wiki's live pages but its home page, at the given wiki version. */
export interface Tree {
  version: number
  pages: TreePage[]
}

/** Why the backend refused a request: the `error` of its answer. */
export type Refusal =
  | 'not_found'
  | 'forbidden'
  | 'managed'
  | 'home_page'
  | 'invalid_parent'
  | 'stale_neighbours'
  | 'edit_conflict'
  | 'invalid_content'
  | 'invalid_grist_url'
  | 'not_in_trash'
  | 'in_trash'
  | 'last_admin'
  | 'not_same_organization'
  | 'invalid_label'
  | 'invalid_request'

/** Rejects with an ApiError when the backend refuses the request. */
export interface PagesApi {
  settings: () => Promise<UserSettings>
  /** Calls back with the settings' version now, then with each new one. */
  watchSettings: (onVersion: (version: number) => void) => () => void

  /** The person's wikis, personal first, then by name; makes the personal one. */
  listWikis: () => Promise<WikiSummary[]>
  /** A shared wiki with the person as admin and an empty home page. */
  createWiki: (wiki: NewWiki) => Promise<Wiki>
  getWiki: (wikiId: string) => Promise<Wiki>
  /** Admin only; a space wiki's name is `managed`. */
  renameWiki: (wikiId: string, changes: WikiChanges) => Promise<Wiki>
  /** Admin only; a personal or space wiki is `managed`. */
  deleteWiki: (wikiId: string) => Promise<void>
  getTree: (wikiId: string) => Promise<Tree>
  /** Calls back with the wiki's version now, then with each new one. */
  watchWiki: (
    wikiId: string,
    onVersion: (version: number) => void
  ) => () => void
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, code: string | null) {
    super(`API answered ${String(status)}${code ? ` ${code}` : ''}`)
    this.status = status
    this.code = code
  }
}
