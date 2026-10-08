import type { Comment } from '@/domain/comment'
import type { Notification } from '@/domain/notification'
import type {
  Block,
  Page,
  PageKind,
  PageRef,
  TrashEntry,
  TreePage,
  Version,
  VersionSummary
} from '@/domain/page'
import type { SearchResult } from '@/domain/search'
import type { Invite, Member, Role, Wiki, WikiSummary } from '@/domain/wiki'

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

export interface Sharing {
  members: Member[]
  /** Shown to admins only: empty for the other members. */
  invites: Invite[]
  /** Whether the members come from elsewhere: a personal or space wiki. */
  managed: boolean
}

/** Someone of the person's organization, to share a wiki with. */
export interface PersonMatch {
  email: string
  name: string | null
}

export interface NewPage {
  /** 1 to 200 characters, trimmed. */
  title: string
  kind: PageKind
  parentId: string | null
  /** The sibling to place it after; it goes last otherwise. */
  afterId?: string
  beforeId?: string
  /** A document's blocks, from its template; none by default. */
  content?: Block[]
  /** Required for a database. */
  gristUrl?: string
}

/** A draft to publish, with the version it started from. */
export type NewVersion = { baseVersion: number; title: string } & (
  { content: Block[] } | { gristUrl: string }
)

/** Where a page goes: last under `parentId`, unless next to a sibling. */
export interface Move {
  parentId: string | null
  afterId?: string
  beforeId?: string
}

/** A page's place in the tree. */
export interface Placement {
  parentId: string | null
  position: string
}

/** A label of a wiki, with the number of live pages carrying it. */
export interface Label {
  name: string
  pages: number
}

export interface LabelledPage {
  id: string
  title: string
  updatedAt: string
}

export interface NewComment {
  /** 1 to 10 000 characters, trimmed; `@email` mentions a member. */
  body: string
  /** The comment it answers, on the same page and no reply itself. */
  parentId?: string
}

export interface Notifications {
  /** Newest first, at most 100. */
  notifications: Notification[]
  /** Every unread one, listed or not. */
  unread: number
}

/** Some notifications by id, all of them, or those about a wiki's pages. */
export type ReadSelection =
  { ids: string[] } | { all: true } | { wikiId: string }

/** How many unread notifications are about the pages of a wiki. */
export interface Badge {
  wikiId: string
  count: number
}

/** A page the person opened lately, and when they last did. */
export type RecentPage = PageRef & { visitedAt: string }

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

  getMembers: (wikiId: string) => Promise<Sharing>
  /** Admin of a shared wiki; the email joins when it signs in, as `role`. */
  invite: (wikiId: string, email: string, role: Role) => Promise<void>
  /** Admin only. */
  cancelInvite: (wikiId: string, inviteId: string) => Promise<void>
  /** Admin of a shared wiki, which always keeps an admin (`last_admin`). */
  setMemberRole: (wikiId: string, userId: string, role: Role) => Promise<void>
  /** Admin of a shared wiki, or the member leaving it. */
  removeMember: (wikiId: string, userId: string) => Promise<void>
  /** People of the person's organization, at most 10. */
  searchPeople: (query: string) => Promise<PersonMatch[]>

  /** Editor; version 1, followed by the person. */
  createPage: (wikiId: string, page: NewPage) => Promise<Page>
  /** Records the visit for the person's recent pages. */
  getPage: (pageId: string) => Promise<Page>
  /** Editor; rejects with an EditConflict when the page moved past `baseVersion`. */
  publish: (pageId: string, version: NewVersion) => Promise<Page>
  /** Newest first. */
  listVersions: (pageId: string) => Promise<VersionSummary[]>
  getVersion: (pageId: string, number: number) => Promise<Version>
  /** Editor; publishes that version's title and content again. */
  restoreVersion: (pageId: string, number: number) => Promise<Page>
  /** Editor; with its descendants, never under one of them nor the home page. */
  movePage: (pageId: string, move: Move) => Promise<Placement>
  /** Editor; the page and its live descendants go to the trash as one branch. */
  deletePage: (pageId: string) => Promise<void>
  /** Editor; trims and lowercases the names, and answers the page's labels. */
  setLabels: (pageId: string, names: string[]) => Promise<string[]>
  /** Whether the person is notified of the page's versions and comments. */
  setFollowing: (pageId: string, following: boolean) => Promise<void>
  setFavorite: (pageId: string, favorite: boolean) => Promise<void>

  /** The wiki's deleted branches, newest first. */
  listTrash: (wikiId: string) => Promise<TrashEntry[]>
  /** Editor; a branch goes back last under its parent if live, else at the top. */
  restorePage: (pageId: string) => Promise<Placement>
  /** Admin; deletes a branch for good. */
  purgePage: (wikiId: string, pageId: string) => Promise<void>
  /** Admin; deletes every branch of the trash for good. */
  emptyTrash: (wikiId: string) => Promise<void>

  /** The wiki's labels, by name. */
  listLabels: (wikiId: string) => Promise<Label[]>
  /** The live pages carrying the label, by title. */
  pagesWithLabel: (wikiId: string, name: string) => Promise<LabelledPage[]>

  /** Oldest first, replies among them. */
  listComments: (pageId: string) => Promise<Comment[]>
  /** Member; its author and the members it mentions follow the page. */
  addComment: (pageId: string, comment: NewComment) => Promise<Comment>
  /** Its author only. */
  editComment: (commentId: string, body: string) => Promise<Comment>
  /** Its author or an admin; its replies go with it. */
  deleteComment: (commentId: string) => Promise<void>

  /** About the pages the person follows or was mentioned on. */
  listNotifications: () => Promise<Notifications>
  markRead: (selection: ReadSelection) => Promise<void>
  /** The wikis with unread notifications, and how many. */
  badges: () => Promise<Badge[]>

  /** Live pages, the latest marked first. */
  favorites: () => Promise<PageRef[]>
  /** Live pages, the latest opened first; at most 20. */
  recent: () => Promise<RecentPage[]>
  /** At most 50 live pages, best first, from every wiki of the person or one. */
  search: (query: string, wikiId?: string) => Promise<SearchResult[]>
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

/** Publishing a draft started from a version older than the current one. */
export class EditConflict extends ApiError {
  readonly current: VersionSummary

  constructor(current: VersionSummary) {
    super(409, 'edit_conflict')
    this.current = current
  }
}
