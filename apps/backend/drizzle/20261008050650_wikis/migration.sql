CREATE TYPE "page_kind" AS ENUM('document', 'database');--> statement-breakpoint
CREATE TYPE "member_role" AS ENUM('viewer', 'editor', 'admin');--> statement-breakpoint
CREATE TYPE "wiki_kind" AS ENUM('personal', 'shared', 'space');--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"page_id" uuid NOT NULL,
	"parent_id" uuid,
	"org_id" text,
	"author_id" uuid NOT NULL,
	"author_email" text NOT NULL,
	"author_name" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "comments_page_id_id_unique" UNIQUE("page_id","id")
);
--> statement-breakpoint
ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"page_id" uuid NOT NULL,
	"wiki_id" uuid NOT NULL,
	"org_id" text,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_email" text NOT NULL,
	"actor_name" text,
	"version" integer,
	"comment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "page_followers" (
	"page_id" uuid,
	"org_id" text,
	"user_id" uuid,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "page_followers_pkey" PRIMARY KEY("page_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "page_followers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"wiki_id" uuid NOT NULL,
	"org_id" text,
	"name" text NOT NULL,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "labels_tenant_id_unique" UNIQUE("tenant","id"),
	CONSTRAINT "labels_wiki_id_name_unique" UNIQUE("wiki_id","name")
);
--> statement-breakpoint
ALTER TABLE "labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "page_favorites" (
	"page_id" uuid,
	"org_id" text,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "page_favorites_pkey" PRIMARY KEY("user_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "page_favorites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "page_labels" (
	"page_id" uuid,
	"label_id" uuid,
	"org_id" text,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "page_labels_pkey" PRIMARY KEY("page_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "page_labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "page_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"page_id" uuid NOT NULL,
	"org_id" text,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"content" jsonb DEFAULT '[]' NOT NULL,
	"grist_url" text,
	"text" text DEFAULT '' NOT NULL,
	"author_id" uuid NOT NULL,
	"author_email" text NOT NULL,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"restored_from" integer,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "page_versions_page_id_number_unique" UNIQUE("page_id","number")
);
--> statement-breakpoint
ALTER TABLE "page_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "page_visits" (
	"page_id" uuid,
	"org_id" text,
	"user_id" uuid,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "page_visits_pkey" PRIMARY KEY("user_id","page_id")
);
--> statement-breakpoint
ALTER TABLE "page_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"wiki_id" uuid NOT NULL,
	"org_id" text,
	"parent_id" uuid,
	"home" boolean DEFAULT false NOT NULL,
	"kind" "page_kind" NOT NULL,
	"title" text NOT NULL,
	"content" jsonb DEFAULT '[]' NOT NULL,
	"grist_url" text,
	"text" text DEFAULT '' NOT NULL,
	"search" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', "title"), 'A') || setweight(to_tsvector('simple', "text"), 'B')) STORED NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"position" text COLLATE "C",
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"trash_root_id" uuid,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "pages_tenant_id_unique" UNIQUE("tenant","id"),
	CONSTRAINT "pages_wiki_id_id_unique" UNIQUE("wiki_id","id"),
	CONSTRAINT "pages_home_document" CHECK (not "home" or ("parent_id" is null and "kind" = 'document')),
	CONSTRAINT "pages_home_outside_tree" CHECK ("home" = ("position" is null)),
	CONSTRAINT "pages_database_grist_url" CHECK (("kind" = 'database') = ("grist_url" is not null)),
	CONSTRAINT "pages_trash_root" CHECK (("deleted_at" is null) = ("trash_root_id" is null)),
	CONSTRAINT "pages_home_not_deleted" CHECK (not ("home" and "deleted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "spaces" (
	"id" uuid PRIMARY KEY,
	"org_id" text NOT NULL,
	"wiki_id" uuid NOT NULL UNIQUE,
	"last_event_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "spaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki_invites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"wiki_id" uuid NOT NULL,
	"org_id" text,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "wiki_invites_wiki_id_email_unique" UNIQUE("wiki_id","email"),
	CONSTRAINT "wiki_invites_email_lower" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
ALTER TABLE "wiki_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki_members" (
	"wiki_id" uuid,
	"org_id" text,
	"user_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"role" "member_role" NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "wiki_members_pkey" PRIMARY KEY("wiki_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "wiki_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wikis" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"org_id" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" "wiki_kind" NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL,
	CONSTRAINT "wikis_tenant_id_unique" UNIQUE("tenant","id")
);
--> statement-breakpoint
ALTER TABLE "wikis" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The app role owns its tables, so the policies only bind it when forced.
ALTER TABLE "wikis" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wiki_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "wiki_invites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "labels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_labels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_favorites" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_visits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "page_followers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spaces" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Policies call this as an uncorrelated subquery, so it runs once per statement.
-- app.membership_lookup lets the wiki_members policy skip its wiki check
-- while this reads the table, which would otherwise recurse through the wikis
-- policy. A function SET clause would restore the flag, but needs a superuser
-- for a custom setting.
CREATE FUNCTION app_member_wiki_ids() RETURNS uuid[]
  LANGUAGE plpgsql
AS $$
DECLARE
  previous text := current_setting('app.membership_lookup', true);
  ids uuid[];
BEGIN
  PERFORM set_config('app.membership_lookup', 'on', true);
  SELECT coalesce(array_agg(wiki_id), '{}') INTO ids
  FROM wiki_members
  WHERE user_id = nullif(current_setting('app.user_id', true), '')::uuid;
  PERFORM set_config('app.membership_lookup', coalesce(previous, ''), true);
  RETURN ids;
END
$$;--> statement-breakpoint
CREATE INDEX "comments_page_id_created_at_index" ON "comments" ("page_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_created_at_index" ON "notifications" ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_id_wiki_id_index" ON "notifications" ("user_id","wiki_id") WHERE "read_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pages_one_home_per_wiki" ON "pages" ("wiki_id") WHERE "home";--> statement-breakpoint
CREATE INDEX "pages_wiki_id_parent_id_index" ON "pages" ("wiki_id","parent_id");--> statement-breakpoint
CREATE INDEX "pages_search_index" ON "pages" USING gin ("search");--> statement-breakpoint
-- Siblings share one order, the top of the tree too, where parent_id is null.
CREATE UNIQUE INDEX "pages_position" ON "pages" ("wiki_id","parent_id","position") NULLS NOT DISTINCT WHERE "deleted_at" is null;--> statement-breakpoint
CREATE INDEX "wiki_invites_email_index" ON "wiki_invites" ("email");--> statement-breakpoint
CREATE INDEX "wiki_members_user_id_index" ON "wiki_members" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wikis_one_personal_per_user" ON "wikis" (coalesce("org_id", ''),"created_by") WHERE "kind" = 'personal';--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_page_id_pages_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_page_id_parent_id_comments_page_id_id_fkey" FOREIGN KEY ("page_id","parent_id") REFERENCES "comments"("page_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_tenant_page_id_pages_tenant_id_fkey" FOREIGN KEY ("tenant","page_id") REFERENCES "pages"("tenant","id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_page_id_pages_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_wiki_id_page_id_pages_wiki_id_id_fkey" FOREIGN KEY ("wiki_id","page_id") REFERENCES "pages"("wiki_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_page_id_comment_id_comments_page_id_id_fkey" FOREIGN KEY ("page_id","comment_id") REFERENCES "comments"("page_id","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_page_id_pages_tenant_id_fkey" FOREIGN KEY ("tenant","page_id") REFERENCES "pages"("tenant","id");--> statement-breakpoint
ALTER TABLE "page_followers" ADD CONSTRAINT "page_followers_page_id_pages_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page_followers" ADD CONSTRAINT "page_followers_tenant_page_id_pages_tenant_id_fkey" FOREIGN KEY ("tenant","page_id") REFERENCES "pages"("tenant","id");--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_wiki_id_wikis_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_tenant_wiki_id_wikis_tenant_id_fkey" FOREIGN KEY ("tenant","wiki_id") REFERENCES "wikis"("tenant","id");--> statement-breakpoint
ALTER TABLE "page_favorites" ADD CONSTRAINT "page_favorites_page_id_pages_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page_favorites" ADD CONSTRAINT "page_favorites_tenant_page_id_pages_tenant_id_fkey" FOREIGN KEY ("tenant","page_id") REFERENCES "pages"("tenant","id");--> statement-breakpoint
ALTER TABLE "page_labels" ADD CONSTRAINT "page_labels_page_id_pages_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page_labels" ADD CONSTRAINT "page_labels_label_id_labels_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page_labels" ADD CONSTRAINT "page_labels_tenant_page_id_pages_tenant_id_fkey" FOREIGN KEY ("tenant","page_id") REFERENCES "pages"("tenant","id");--> statement-breakpoint
ALTER TABLE "page_labels" ADD CONSTRAINT "page_labels_tenant_label_id_labels_tenant_id_fkey" FOREIGN KEY ("tenant","label_id") REFERENCES "labels"("tenant","id");--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_page_id_pages_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page_versions" ADD CONSTRAINT "page_versions_tenant_page_id_pages_tenant_id_fkey" FOREIGN KEY ("tenant","page_id") REFERENCES "pages"("tenant","id");--> statement-breakpoint
ALTER TABLE "page_visits" ADD CONSTRAINT "page_visits_page_id_pages_id_fkey" FOREIGN KEY ("page_id") REFERENCES "pages"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page_visits" ADD CONSTRAINT "page_visits_tenant_page_id_pages_tenant_id_fkey" FOREIGN KEY ("tenant","page_id") REFERENCES "pages"("tenant","id");--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_wiki_id_wikis_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_wiki_id_parent_id_pages_wiki_id_id_fkey" FOREIGN KEY ("wiki_id","parent_id") REFERENCES "pages"("wiki_id","id");--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_tenant_wiki_id_wikis_tenant_id_fkey" FOREIGN KEY ("tenant","wiki_id") REFERENCES "wikis"("tenant","id");--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_org_id_wiki_id_wikis_tenant_id_fkey" FOREIGN KEY ("org_id","wiki_id") REFERENCES "wikis"("tenant","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki_invites" ADD CONSTRAINT "wiki_invites_wiki_id_wikis_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki_invites" ADD CONSTRAINT "wiki_invites_tenant_wiki_id_wikis_tenant_id_fkey" FOREIGN KEY ("tenant","wiki_id") REFERENCES "wikis"("tenant","id");--> statement-breakpoint
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_wiki_id_wikis_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki_members" ADD CONSTRAINT "wiki_members_tenant_wiki_id_wikis_tenant_id_fkey" FOREIGN KEY ("tenant","wiki_id") REFERENCES "wikis"("tenant","id");--> statement-breakpoint
CREATE POLICY "tenant" ON "comments" AS PERMISSIVE FOR ALL TO public USING ("comments"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("comments"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "comments"."page_id"))) WITH CHECK ("comments"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("comments"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "comments"."page_id")));--> statement-breakpoint
CREATE POLICY "tenant" ON "notifications" AS PERMISSIVE FOR ALL TO public USING ("notifications"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("notifications"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "notifications"."page_id"))) WITH CHECK ("notifications"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("notifications"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "notifications"."page_id")));--> statement-breakpoint
CREATE POLICY "own_select" ON "notifications" AS RESTRICTIVE FOR SELECT TO public USING ("notifications"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "own_update" ON "notifications" AS RESTRICTIVE FOR UPDATE TO public USING ("notifications"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "own_delete" ON "notifications" AS RESTRICTIVE FOR DELETE TO public USING ("notifications"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant" ON "page_followers" AS PERMISSIVE FOR ALL TO public USING ("page_followers"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_followers"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_followers"."page_id"))) WITH CHECK ("page_followers"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_followers"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_followers"."page_id")));--> statement-breakpoint
CREATE POLICY "tenant" ON "labels" AS PERMISSIVE FOR ALL TO public USING ("labels"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("labels"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "labels"."wiki_id"))) WITH CHECK ("labels"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("labels"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "labels"."wiki_id")));--> statement-breakpoint
CREATE POLICY "tenant" ON "page_favorites" AS PERMISSIVE FOR ALL TO public USING ("page_favorites"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_favorites"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_favorites"."page_id"))) WITH CHECK ("page_favorites"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_favorites"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_favorites"."page_id")));--> statement-breakpoint
CREATE POLICY "own" ON "page_favorites" AS RESTRICTIVE FOR ALL TO public USING ("page_favorites"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("page_favorites"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant" ON "page_labels" AS PERMISSIVE FOR ALL TO public USING ("page_labels"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_labels"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_labels"."page_id"))) WITH CHECK ("page_labels"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_labels"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_labels"."page_id")));--> statement-breakpoint
CREATE POLICY "tenant" ON "page_versions" AS PERMISSIVE FOR ALL TO public USING ("page_versions"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_versions"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_versions"."page_id"))) WITH CHECK ("page_versions"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_versions"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_versions"."page_id")));--> statement-breakpoint
CREATE POLICY "tenant" ON "page_visits" AS PERMISSIVE FOR ALL TO public USING ("page_visits"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_visits"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_visits"."page_id"))) WITH CHECK ("page_visits"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_visits"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_visits"."page_id")));--> statement-breakpoint
CREATE POLICY "own" ON "page_visits" AS RESTRICTIVE FOR ALL TO public USING ("page_visits"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid) WITH CHECK ("page_visits"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant" ON "pages" AS PERMISSIVE FOR ALL TO public USING ("pages"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("pages"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "pages"."wiki_id"))) WITH CHECK ("pages"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("pages"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "pages"."wiki_id")));--> statement-breakpoint
CREATE POLICY "tenant" ON "spaces" AS PERMISSIVE FOR ALL TO public USING ("spaces"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '')) WITH CHECK ("spaces"."org_id" is not distinct from nullif(current_setting('app.org_id', true), ''));--> statement-breakpoint
CREATE POLICY "space_lookup" ON "spaces" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.space_lookup', true) = 'on');--> statement-breakpoint
CREATE POLICY "tenant" ON "wiki_invites" AS PERMISSIVE FOR ALL TO public USING ("wiki_invites"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("wiki_invites"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "wiki_invites"."wiki_id") or "wiki_invites"."email" = lower(current_setting('app.user_email', true)))) WITH CHECK ("wiki_invites"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("wiki_invites"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "wiki_invites"."wiki_id") or "wiki_invites"."email" = lower(current_setting('app.user_email', true))));--> statement-breakpoint
CREATE POLICY "tenant" ON "wiki_members" AS PERMISSIVE FOR ALL TO public USING ("wiki_members"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("wiki_members"."org_id" is not null or current_setting('app.membership_lookup', true) = 'on' or exists (select 1 from "wikis" where "wikis"."id" = "wiki_members"."wiki_id"))) WITH CHECK ("wiki_members"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("wiki_members"."org_id" is not null or current_setting('app.membership_lookup', true) = 'on' or exists (select 1 from "wikis" where "wikis"."id" = "wiki_members"."wiki_id")));--> statement-breakpoint
CREATE POLICY "tenant" ON "wikis" AS PERMISSIVE FOR ALL TO public USING ("wikis"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("wikis"."org_id" is not null or "wikis"."created_by" = nullif(current_setting('app.user_id', true), '')::uuid or "wikis"."id" = any((select app_member_wiki_ids())::uuid[]))) WITH CHECK ("wikis"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("wikis"."org_id" is not null or "wikis"."created_by" = nullif(current_setting('app.user_id', true), '')::uuid or "wikis"."id" = any((select app_member_wiki_ids())::uuid[])));--> statement-breakpoint
-- Turns the signed-in person's invites in their tenant into memberships. A B2C
-- person cannot see a wiki before joining it, so the insert runs under
-- app.membership_lookup (see app_member_wiki_ids); the invites policy still
-- keeps it to their tenant.
CREATE FUNCTION app_claim_invites() RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  previous text := current_setting('app.membership_lookup', true);
BEGIN
  PERFORM set_config('app.membership_lookup', 'on', true);
  WITH claimed AS (
    DELETE FROM wiki_invites
    WHERE email = lower(current_setting('app.user_email', true))
    RETURNING wiki_id, org_id, email, role
  )
  INSERT INTO wiki_members (wiki_id, org_id, user_id, email, role)
  SELECT wiki_id, org_id, nullif(current_setting('app.user_id', true), '')::uuid, email, role
  FROM claimed
  ON CONFLICT (wiki_id, user_id) DO NOTHING;
  PERFORM set_config('app.membership_lookup', coalesce(previous, ''), true);
END
$$;--> statement-breakpoint
-- Sent on commit, to the replicas streaming the wiki's changes.
CREATE FUNCTION notify_wiki_change() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('wiki_changes', NEW.id || ' ' || NEW.version);
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER wikis_notify_change AFTER UPDATE OF version ON wikis
  FOR EACH ROW WHEN (NEW.version IS DISTINCT FROM OLD.version)
  EXECUTE FUNCTION notify_wiki_change();