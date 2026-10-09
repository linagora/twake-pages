ALTER POLICY "tenant" ON "notifications" TO public USING ("notifications"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("notifications"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "notifications"."page_id") or "notifications"."user_id" = nullif(current_setting('app.leaving_user', true), '')::uuid)) WITH CHECK ("notifications"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("notifications"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "notifications"."page_id")));--> statement-breakpoint
ALTER POLICY "tenant" ON "page_followers" TO public USING ("page_followers"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_followers"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_followers"."page_id") or "page_followers"."user_id" = nullif(current_setting('app.leaving_user', true), '')::uuid)) WITH CHECK ("page_followers"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_followers"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_followers"."page_id")));--> statement-breakpoint
-- Forgets what Pages keeps for a deleted account about pages: its favorites,
-- visits, follows and notifications, those its changes sent to others aside.
-- A person keeps their follows and notifications of a wiki they leave, which
-- in B2C the wiki's pages then hide even from them, so the tenant policies of
-- page_followers and notifications show, in USING only, the rows of
-- app.leaving_user, which the function names the person by while it deletes.
-- Their favorites and visits of such a wiki went as they left it
-- (app_leave_wiki). SECURITY DEFINER would not lift the policies: the
-- function would run as the tables' owner, whom FORCE ROW LEVEL SECURITY
-- keeps under them.
CREATE FUNCTION app_forget_user(person uuid) RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  previous text := current_setting('app.leaving_user', true);
BEGIN
  PERFORM set_config('app.leaving_user', person::text, true);
  DELETE FROM page_favorites WHERE user_id = person;
  DELETE FROM page_visits WHERE user_id = person;
  DELETE FROM page_followers WHERE user_id = person;
  DELETE FROM notifications WHERE user_id = person;
  PERFORM set_config('app.leaving_user', coalesce(previous, ''), true);
END
$$;