# Twake Pages HTTP API (v1)

The backend serves JSON under `/api`, like Twake Tasks (the paths below leave the prefix out), and `/health/live`, `/health/ready` at the root. Every API route but the back-channel logout needs `Authorization: Bearer <access token>`; a missing or rejected token answers `401` with no body.

Ids are UUIDv7 strings. Times are ISO 8601 strings in UTC. Bodies are validated with zod: a malformed id or version number in the path answers `404 { error: 'not_found' }`, a malformed body `400 { error: 'invalid_request' }`. A failure of the server answers `500 { error: 'server_error' }`, and its cause goes only to the log.

A refusal answers `{ error: <Refusal> }` with its status:

| Refusal | Status | When |
|---|---|---|
| `not_found` | 404 | the wiki, page, comment, label or version does not exist, or the person cannot see it |
| `forbidden` | 403 | the person's role does not allow it |
| `managed` | 409 | members or name of a space's wiki, or sharing a personal wiki |
| `home_page` | 409 | moving or deleting the home page |
| `invalid_parent` | 400 | the parent is not a live page of the same wiki, is its home page, or is the page itself or one of its descendants |
| `stale_neighbours` | 409 | `afterId` or `beforeId` is not a live sibling under the given parent |
| `edit_conflict` | 409 | publishing from a version older than the current one (body below) |
| `invalid_content` | 400 | blocks too large (over 2 MiB of JSON), a link that is not `http:`, `https:` or `mailto:`, an image, video, audio or file address that is not `https:`, a Grist embed outside `GRIST_ORIGINS`, or a NUL character or a lone surrogate in any key or string of the blocks |
| `invalid_grist_url` | 400 | a database page address outside `GRIST_ORIGINS` |
| `not_in_trash` | 409 | restoring or purging a page that is not the root of a deleted branch |
| `in_trash` | 409 | publishing, moving, labelling or commenting a deleted page |
| `last_admin` | 409 | removing or demoting the last admin of a shared wiki |
| `not_same_organization` | 400 | inviting an email of another domain than the person's: outside the organization (B2B), or a B2B email from B2C |
| `invalid_label` | 400 | a label name that is not 1 to 50 letters with their marks, decimal digits, `-` or `_` |

## Types

```ts
type Role = 'viewer' | 'editor' | 'admin'
type WikiKind = 'personal' | 'shared' | 'space'
type PageKind = 'document' | 'database'
type Block = Record<string, unknown> // a BlockNote block, stored as sent

interface Person { id: string; email: string; name: string | null }

interface WikiRef { id: string; name: string; kind: WikiKind }

interface WikiSummary {
  id: string
  name: string
  description: string
  kind: WikiKind
  role: Role
  homePageId: string
  unread: number // the person's unread notifications about pages of this wiki
}

interface Wiki extends WikiSummary {
  version: number // live updates version
}

interface TreePage {
  id: string
  parentId: string | null // null at the top of the tree
  position: string // fractional key, compare with < on strings
  title: string
  kind: PageKind
}

interface Page {
  id: string
  wikiId: string
  parentId: string | null
  home: boolean
  kind: PageKind
  title: string
  content: Block[] // [] for a database page
  gristUrl: string | null // set for a database page
  version: number // number of the current version, from 1
  createdAt: string
  createdBy: Person
  updatedAt: string // time of the current version
  updatedBy: Person // author of the current version
  labels: string[] // label names, sorted
  ancestors: { id: string; title: string }[] // from the top of the tree down to the parent
  following: boolean
  favorite: boolean
  deletedAt: string | null
}

interface VersionSummary {
  number: number
  title: string
  author: Person
  createdAt: string
  restoredFrom: number | null
}

interface Version extends VersionSummary {
  content: Block[]
  gristUrl: string | null
}

interface Member extends Person { role: Role; joinedAt: string }
interface Invite { id: string; email: string; role: Role; createdAt: string }

interface Comment {
  id: string
  parentId: string | null // replies are one level deep
  author: Person
  body: string // plain text, mentions written @email
  createdAt: string
  editedAt: string | null
}

type NotificationReason = 'published' | 'commented' | 'mentioned'

interface Notification {
  id: string
  reason: NotificationReason
  page: { id: string; title: string }
  wiki: WikiRef
  actor: Person
  version: number | null // for published
  commentId: string | null // for commented and mentioned
  createdAt: string
  readAt: string | null
}

interface PageRef { id: string; title: string; wiki: WikiRef }

interface SearchResult {
  page: PageRef
  // The page's title, each found word between U+E000 and U+E001.
  markedTitle: string
  // Plain text around the words found, each found word between U+E000 and U+E001.
  excerpt: string
  updatedAt: string
}

interface TrashEntry {
  id: string // root of the deleted branch
  title: string
  deletedAt: string
  deletedBy: Person
  descendants: number // pages deleted with it
}
```

## Wikis

| Method and path | Body | Answer | Who |
|---|---|---|---|
| `GET /wikis` | | `{ wikis: WikiSummary[] }`, personal first, then by name. Creates the personal wiki on first call. | anyone |
| `POST /wikis` | `{ name, description? }` | `201 Wiki`, kind `shared`, the creator admin, with an empty home page titled after the wiki, which the creator follows | anyone |
| `GET /wikis/:wikiId` | | `Wiki` | member |
| `PATCH /wikis/:wikiId` | `{ name?, description? }` | `Wiki`; `managed` for the name of a space's wiki | admin |
| `DELETE /wikis/:wikiId` | | `204`; `managed` for a personal or space wiki | admin |
| `GET /wikis/:wikiId/tree` | | `{ version, pages: TreePage[] }`, live pages only, home page excluded | member |
| `GET /wikis/:wikiId/stream` | | `text/event-stream`, see Live updates | member |

`name` is 1 to 100 characters, trimmed; `description` at most 500. Neither holds a NUL character or a lone surrogate.

The personal wiki is stored with the name `Personal`. Clients show a translated label for a wiki of kind `personal` instead of its name, as Twake Tasks shows `t('boards.personalProject')` for a personal project.

## Sharing

| Method and path | Body | Answer | Who |
|---|---|---|---|
| `GET /wikis/:wikiId/members` | | `{ members: Member[], invites: Invite[], managed: boolean }` | member (invites: admin only, else `[]`) |
| `POST /wikis/:wikiId/invites` | `{ email, role }` | `202 { status: 'invited' }`, whether the email has an account or not | admin, shared wiki |
| `DELETE /wikis/:wikiId/invites/:inviteId` | | `204`, also for an invitation already gone | admin, shared wiki |
| `PATCH /wikis/:wikiId/members/:userId` | `{ role }` | `204` | admin, shared wiki |
| `DELETE /wikis/:wikiId/members/:userId` | | `204`; a member may remove themself | admin, shared wiki |
| `GET /people?q=` | | `{ people: { email, name }[] }`, at most 10, same organization; `[]` in B2C | anyone |

An invitation goes to an email of the inviting person's domain only, else `not_same_organization`. Twake Workplace gives an organization one mail domain, and B2C users that of their provider: the domain thus gives an email's tenant without saying whether it has an account.

## Pages

| Method and path | Body | Answer | Who |
|---|---|---|---|
| `POST /wikis/:wikiId/pages` | `NewPage` | `201 Page`, version 1, the creator follows it | editor |
| `GET /pages/:pageId` | | `Page`; records the visit for Recent | member |
| `POST /pages/:pageId/versions` | `{ baseVersion, title, content }` or, for a database page, `{ baseVersion, title, gristUrl }` | `201 Page`, the author follows it; `409 { error: 'edit_conflict', current: VersionSummary }` | editor |
| `GET /pages/:pageId/versions` | | `{ versions: VersionSummary[] }`, newest first | member |
| `GET /pages/:pageId/versions/:number` | | `Version` | member |
| `POST /pages/:pageId/versions/:number/restore` | | `201 Page`, a new version with `restoredFrom`, the person follows it; restoring the current version publishes it again; the version's blocks or Grist address are checked again, as a draft's | editor |
| `POST /pages/:pageId/move` | `{ parentId, afterId?, beforeId? }` | `{ parentId, position }` | editor |
| `DELETE /pages/:pageId` | | `204`, the page and its live descendants go to the trash | editor |
| `PUT /pages/:pageId/labels` | `{ names: string[] }`, at most 50 | `{ labels: string[] }`, creating missing labels in the wiki | editor |
| `PUT /pages/:pageId/follow` / `DELETE` | | `204` | member |
| `PUT /pages/:pageId/favorite` / `DELETE` | | `204` | member |

```ts
interface NewPage {
  title: string // 1 to 200 characters, trimmed
  kind: PageKind
  parentId: string | null
  afterId?: string // place after this sibling; default: last
  beforeId?: string
  content?: Block[] // document: the template's blocks, default []
  gristUrl?: string // database: required
}
```

`title` is 1 to 200 characters, trimmed, with no NUL character and no lone surrogate, which the server refuses rather than strips. `content` is an array of BlockNote blocks. The server checks its size, its strings, its links and the addresses of its blocks (see `invalid_content`) and keeps a plain text copy, a line per block, per table cell and per caption (`props.caption`), but never rewrites it. A link is an inline `{ type: 'link', href }`, wherever it sits. An `image`, `video`, `audio` or `file` block, and a Grist embed (`type: 'gristEmbed'`), hold their address in `props.url`, empty until they have one.

A move takes the page with its child pages, which keep their places under it. Its `afterId` and `beforeId` name the page's new siblings as they are once the page is lifted out, as Twake Tasks names those of a moved task: the page itself is never one of them.

## Trash

| Method and path | Answer | Who |
|---|---|---|
| `GET /wikis/:wikiId/trash` | `{ pages: TrashEntry[] }`, newest first | member |
| `POST /pages/:pageId/restore` | `{ parentId, position }`: under its parent if live, else at the top, last | editor |
| `DELETE /wikis/:wikiId/trash/:pageId` | `204`, the branch is deleted for good | admin |
| `DELETE /wikis/:wikiId/trash` | `204`, every branch is deleted for good | admin |

## Labels

| Method and path | Answer | Who |
|---|---|---|
| `GET /wikis/:wikiId/labels` | `{ labels: { name: string; pages: number }[] }`, by name | member |
| `GET /wikis/:wikiId/labels/:name/pages` | `{ pages: { id, title, updatedAt }[] }`, live pages, by title | member |

A label name, in `PUT /pages/:pageId/labels` as in `:name`, is trimmed, lowercased and put in Unicode's composed form (NFC), so that an `é` typed in one character or in two makes one label; it then holds 1 to 50 letters with their marks, decimal digits, `-` or `_`. The list shows the labels that live pages carry, and `pages` counts those live pages; a name no live page carries answers `{ pages: [] }`. A label no page uses any more, in the tree or in the trash, is deleted.

## Comments

| Method and path | Body | Answer | Who |
|---|---|---|---|
| `GET /pages/:pageId/comments` | | `{ comments: Comment[] }`, oldest first | member |
| `POST /pages/:pageId/comments` | `{ body, parentId? }` | `201 Comment`; the author follows the page | member |
| `PATCH /comments/:commentId` | `{ body }` | `Comment` | its author |
| `DELETE /comments/:commentId` | | `204`, with its replies | its author, or an admin |

`body` is 1 to 10 000 characters, trimmed. `parentId` names a comment of the same page that is not itself a reply. `@email` of a member of the wiki mentions them: they follow the page and get a `mentioned` notification; an email that is no member's is left as text.

## Following and notifications

Notifications are never sent to the person who acted, nor to people who are no longer members. Those about a wiki the person is no longer a member of are left out of the list, the unread counts and the badges.

- Publishing (version 2 and later, restores included): `published` to followers.
- A comment: `commented` to followers, and `mentioned` instead to the people it mentions.

| Method and path | Body | Answer |
|---|---|---|
| `GET /notifications` | | `{ notifications: Notification[], unread: number }`, newest first, at most 100 |
| `POST /notifications/read` | `{ ids: string[] }` or `{ all: true }` or `{ wikiId }` | `204` |
| `GET /badges` | | `{ badges: { wikiId: string; count: number }[] }`, unread per wiki, only counts above 0 |

## Finding

| Method and path | Answer |
|---|---|
| `GET /favorites` | `{ pages: PageRef[] }`, live pages, most recently marked first |
| `GET /recent` | `{ pages: (PageRef & { visitedAt: string })[] }`, live pages, the last opened first, at most 20 |
| `GET /search?q=&wikiId=` | `{ results: SearchResult[] }`, at most 50, best first; `q` 1 to 200 characters; without `wikiId`, every wiki of the person |

Search reads the words of `q` as PostgreSQL's `simple` configuration splits the text of a page: an email, a host or a version number whole, a hyphenated word or an address also in its parts. It finds the live pages whose title or text holds every word, the last one as the beginning of a word, and ranks them: first the pages whose titles hold more of the words, so that a word of the title comes above one of the text; then, among pages whose titles hold as many, by `ts_rank` over the title, weighted `A`, and the text, weighted `B`, with PostgreSQL's default weights; then the last published first. Quotes, `&`, `|`, `!`, `:`, `*`, parentheses and whatever else full text search reads as an operator are text, so a `q` without a word finds nothing. `q` is trimmed, with no NUL character and no lone surrogate, as a title, and is checked before `wikiId`; a `wikiId` the person cannot see, or a malformed one, answers `not_found`.

`markedTitle` is the whole title, each word found marked: Twake Tasks highlights the searched text in a task's title on the client, but only PostgreSQL knows the words it found. The excerpt quotes the text with its whitespace run together, five words before the first word found and eight after, as Twake Tasks quotes a task's description, with `…` where the text goes on. It is empty when the text holds none of the words found, for a page found by its title alone or one without text, just as Tasks quotes no description without the searched text. Unlike Tasks, which quotes no description of a task whose title holds the searched text, a page whose title holds words found still quotes its text when the text holds some, as the words of `q` may be found apart. A U+E000 or U+E001 of the title or of the text shows as a blank.

## Settings and health

| Method and path | Answer |
|---|---|
| `GET /settings` | `{ version, language, timezone, theme, avatar, name }`, the person's settings from the common settings events, as in Twake Tasks: `theme` is `light`, `dark` or `auto` (the default), `name` the display name, else the first and last names; `language`, `timezone`, `avatar` and `name` are `null` when unset, and `version` is `-1` until a first event |
| `GET /settings/events` | `text/event-stream`, see Live updates |
| `GET /health/live`, `GET /health/ready` | `{ status }` |

## Live updates

`GET /wikis/:wikiId/stream` sends `event: version` with `id: <version>` and `data: {"version": <n>}` each time the wiki's version moves: a page created, published, moved, deleted, restored or purged, labels changed, a comment written, edited or deleted, a member or invite changed, the wiki renamed, its description changed, the wiki deleted. The client reloads what it shows of that wiki. A first message carries the current version, and a keep-alive comment goes out every 25 seconds.

`GET /settings/events` sends the same messages for the person's settings, with their `version`, each time a newer settings event is kept. The client reloads `GET /settings` when the version is newer than the one it shows. The first message carries the current version, `-1` before any event, and the keep-alive is the same.

## Activity events

Published on the `activity` exchange through the outbox, as `com.twake.pages.page.<action>.v1`, `source: 'twake://pages'`:

```json
{
  "specversion": "1.0",
  "id": "<uuidv7>",
  "source": "twake://pages",
  "type": "com.twake.pages.page.published.v1",
  "time": "2026-10-08T07:30:00.000000Z",
  "twakeorg": "acme",
  "twakeactorid": "<uuid>",
  "twakeactor": "alice@acme.example",
  "data": {
    "object": {
      "type": "page",
      "id": "<page id>",
      "title": "Release checklist",
      "container": { "kind": "wiki", "id": "<wiki id>" }
    },
    "version": 4,
    "preview": "First 280 characters of the text..."
  }
}
```

- `created` (with `data.preview`), `moved` (`data.from` and `data.to` parent ids, null at the top), `deleted` and `restored` (`data.descendants`). `moved` goes out when a page changes parent, not when it changes place among the same siblings, as Twake Tasks tells only of a task moved to another section.
- `published` for every version after the first, with `data.version` and `data.preview`.
- `commented` with `data.commentId`, `data.preview` (the comment), and `data.recipients` for the people mentioned: `{ uuid, email, reason: 'mentioned' }`.
- The space integration publishes `com.twake.pages.space.provisioned.v1` with `data: { space_id, resource: { kind: 'wiki', id } }`.
