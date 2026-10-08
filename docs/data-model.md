# Twake Pages data model (v1)

PostgreSQL 18, drizzle, with the conventions of Twake Tasks (`apps/backend/src/infra/db.ts`):

- Every tenant table has `org_id text` (`organizationId()`), the generated `tenant` column (`tenant()`), `pgTable.withRLS`, `FORCE ROW LEVEL SECURITY` in its migration, and a `tenantPolicy`. B2C rows (no organization) are scoped by wiki membership, exactly as Twake Tasks scopes them by project membership.
- Ids are `uuid default uuidv7()`. Child rows reference their parent through `(tenant, parent_id)` as well as `parent_id`, so a row never points into another tenant.
- People are their LDAP `entryUUID` (`user_id uuid`), with the email and the name kept beside it for display.
- Orders are `sortKey()` (`text COLLATE "C"`), from the fractional key helper of Twake Tasks.

## Tables

### wikis

| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| org_id, tenant | | |
| name | text | |
| description | text not null default '' | |
| kind | enum `wiki_kind` (`personal`, `shared`, `space`) | |
| version | bigint not null default 0 | live updates; `NOTIFY wiki_changes '<id> <version>'` on change, by trigger as `boards_notify_change` |
| created_by | uuid | |
| created_at | timestamptz | |
| deleted_at | timestamptz | a deleted wiki is out of reach until it is purged |

- `unique (tenant, id)`
- `wikis_one_personal_per_user`: unique `(coalesce(org_id, ''), created_by) where kind = 'personal'`
- B2C scope: `created_by = currentUser or id = any((select app_member_wiki_ids())::uuid[])`

A space wiki's `created_by` is its space id, which no route shows and the purge job runs as, while its home page is written by the first admin with a `uuid` in the event that creates the wiki (`twake.space.created` or `twake.space.synced`), or by the space, with its id and name, when that event names none.

### wiki_members, wiki_invites

Same columns, keys and policies as `project_members` and `project_invites` of Twake Tasks, with `wiki_id`, but for one deliberate difference: the B2C scope of `wiki_invites` matches the person's email in `USING` only, not in `WITH CHECK`. The email lets a B2C person see the invites to them, which `app_claim_invites()` deletes; in `WITH CHECK` it would let them write an invite to their own email on any B2C wiki, or raise the role of one sent to them, then claim it. `app_member_wiki_ids()` and `app_claim_invites()` are the Twake Tasks functions with the names changed.

### pages

| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| wiki_id | uuid | cascade |
| org_id, tenant | | |
| parent_id | uuid null | `(wiki_id, parent_id)` references `pages (wiki_id, id)` |
| home | boolean not null default false | |
| kind | enum `page_kind` (`document`, `database`) | |
| title | text | current version's |
| content | jsonb not null default '[]' | current version's blocks |
| grist_url | text | current version's, database pages only |
| text | text not null default '' | plain text of the blocks, for search and previews |
| search | tsvector | generated: `setweight(to_tsvector('simple', title), 'A') \|\| setweight(to_tsvector('simple', text), 'B')`, GIN index |
| version | integer not null default 1 | number of the current version |
| position | sortKey null | among siblings; null for the home page, which is outside the tree |
| created_by, created_at | | |
| updated_by, updated_at | | author and time of the current version |
| deleted_at | timestamptz | in the trash |
| deleted_by | uuid | |
| trash_root_id | uuid | the root of the deleted branch it went with; equals `id` for the root |

- `unique (tenant, id)`, `unique (wiki_id, id)`
- `pages_one_home_per_wiki`: unique `(wiki_id) where home`
- `pages_position`: unique `(wiki_id, parent_id, position) nulls not distinct where deleted_at is null`
- index `(wiki_id, parent_id)`, GIN on `search`
- checks: `not home or (parent_id is null and kind = 'document')`; `home = (position is null)`; `(kind = 'database') = (grist_url is not null)`; `(deleted_at is null) = (trash_root_id is null)`; `not (home and deleted_at is not null)`
- policy: tenant, B2C scope `exists (select 1 from wikis where wikis.id = pages.wiki_id)`

A page whose wiki is deleted stays in the table until the purge, and is out of reach through the wiki's policy-checked lookup in the access function.

### page_versions

| Column | Type |
|---|---|
| id | uuid |
| page_id | uuid, cascade |
| org_id, tenant | |
| number | integer, `unique (page_id, number)` |
| title | text |
| content | jsonb |
| grist_url | text |
| text | text |
| author_id | uuid |
| author_email | text |
| author_name | text |
| created_at | timestamptz |
| restored_from | integer null |

### labels, page_labels

As `labels` and `task_labels` of Twake Tasks: `labels (id, wiki_id, org_id, name, tenant)` with `unique (wiki_id, name)`, `page_labels (page_id, label_id, org_id, tenant)`.

### comments

`id, page_id (cascade), parent_id (references comments (page_id, id), cascade), org_id, author_id, author_email, author_name, body, created_at, edited_at, tenant`; index `(page_id, created_at)`.

### page_followers

As `task_followers`: `page_id, org_id, user_id, tenant`, primary key `(page_id, user_id)`.

### notifications

As in Twake Tasks, about pages: `id, page_id (cascade), wiki_id, org_id, user_id, reason (text: published, commented, mentioned), actor_id, actor_email, actor_name, version, comment_id (cascade), created_at, read_at, tenant`; index `(user_id, created_at)` and `(user_id, wiki_id) where read_at is null`; the restrictive `own_select`, `own_update`, `own_delete` policies of Twake Tasks.

### page_favorites, page_visits

`(user_id, page_id)` primary key, `org_id`, `tenant`, `created_at` or `visited_at`; tenant policy on the page and the restrictive `own` policy (`ownRows`) of Twake Tasks. Visits are capped at the 100 most recent per person, those of wikis the person left included: `app_trim_visits()` deletes the older ones under `app.visits_lookup`, which the B2C scope of the `page_visits` tenant policy honors in `USING` only, as the `wiki_members` one honors `app.membership_lookup`.

### Platform tables

Copied from Twake Tasks with the names it uses: `spaces` (space id, organization, `wiki_id`, `last_event_at`; the wiki's `deleted_at` marks a deleted space), `processed_events`, `outbox`, `jobs`, `user_settings`, and the auth tables (revoked sessions).

## The access function

`roleOn(tx, identity, wikiId)` returns the person's role on the wiki, or nothing when the wiki is deleted, invisible, or the person is no member. Every route goes through it, as `access.ts` does in Twake Tasks. A person is the admin of their personal wiki.

## Purge

A `jobs` row per deleted branch, due 30 days after its deletion, and per deleted wiki. The purge job deletes the pages of the branch (cascading versions, labels, comments, followers, notifications, favorites, visits) or the wiki.

An account deletion purges at once, rather than 30 days later, the wikis it removes: the person's personal wiki, and a shared wiki they were the only admin of, with no editor to pass it to. Twake Tasks does so under ADR 009. A wiki already deleted keeps its job. An organization's deletion purges its wikis at once, deleted or not, and drops its jobs.
