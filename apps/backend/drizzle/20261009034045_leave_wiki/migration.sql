ALTER POLICY "own" ON "page_favorites" TO public USING ("page_favorites"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid or "page_favorites"."user_id" = nullif(current_setting('app.leaving_user', true), '')::uuid) WITH CHECK ("page_favorites"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
ALTER POLICY "own" ON "page_visits" TO public USING ("page_visits"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid or "page_visits"."user_id" = nullif(current_setting('app.leaving_user', true), '')::uuid) WITH CHECK ("page_visits"."user_id" = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint
-- Forgets the person's favorites and visits of the wiki's pages as they leave
-- it, removed by an admin or by themself; what they wrote, their follows and
-- their notifications stay. The own policy keeps everyone to their own rows,
-- and in USING to those of app.leaving_user, which the function names the
-- person by while it deletes. It runs before the membership goes, which in
-- B2C shows the wiki's pages to a person leaving by themself. SECURITY
-- DEFINER would not lift the policy: the function would run as the tables'
-- owner, whom FORCE ROW LEVEL SECURITY keeps under it.
CREATE FUNCTION app_leave_wiki(wiki uuid, person uuid) RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  previous text := current_setting('app.leaving_user', true);
BEGIN
  PERFORM set_config('app.leaving_user', person::text, true);
  DELETE FROM page_favorites
  WHERE user_id = person
    AND page_id IN (SELECT id FROM pages WHERE wiki_id = wiki);
  DELETE FROM page_visits
  WHERE user_id = person
    AND page_id IN (SELECT id FROM pages WHERE wiki_id = wiki);
  PERFORM set_config('app.leaving_user', coalesce(previous, ''), true);
END
$$;