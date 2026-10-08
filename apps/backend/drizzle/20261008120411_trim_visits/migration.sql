ALTER POLICY "tenant" ON "page_visits" TO public USING ("page_visits"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_visits"."org_id" is not null or current_setting('app.visits_lookup', true) = 'on' or exists (select 1 from "pages" where "pages"."id" = "page_visits"."page_id"))) WITH CHECK ("page_visits"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("page_visits"."org_id" is not null or exists (select 1 from "pages" where "pages"."id" = "page_visits"."page_id")));--> statement-breakpoint
-- Keeps the signed-in person's most recent visits. In B2C the tenant policy
-- hides the visits of wikis the person left, but under app.visits_lookup, as
-- app_member_wiki_ids reads wiki_members under app.membership_lookup; the own
-- policy still keeps the trim to the person's visits. SECURITY DEFINER would
-- not lift the policy: the function would run as the tables' owner, whom
-- FORCE ROW LEVEL SECURITY keeps under it.
CREATE FUNCTION app_trim_visits(kept integer) RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  previous text := current_setting('app.visits_lookup', true);
  person uuid := nullif(current_setting('app.user_id', true), '')::uuid;
BEGIN
  PERFORM set_config('app.visits_lookup', 'on', true);
  DELETE FROM page_visits
  WHERE user_id = person
    AND page_id NOT IN (
      SELECT page_id FROM page_visits
      WHERE user_id = person
      ORDER BY visited_at DESC
      LIMIT kept
    );
  PERFORM set_config('app.visits_lookup', coalesce(previous, ''), true);
END
$$;
