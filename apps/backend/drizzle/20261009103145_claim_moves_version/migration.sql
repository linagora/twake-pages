ALTER POLICY "tenant" ON "wikis" TO public USING ("wikis"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("wikis"."org_id" is not null or "wikis"."created_by" = nullif(current_setting('app.user_id', true), '')::uuid or "wikis"."id" = any((select app_member_wiki_ids())::uuid[]) or "wikis"."id" = any((select nullif(current_setting('app.claimed_wikis', true), ''))::uuid[]))) WITH CHECK ("wikis"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("wikis"."org_id" is not null or "wikis"."created_by" = nullif(current_setting('app.user_id', true), '')::uuid or "wikis"."id" = any((select app_member_wiki_ids())::uuid[])));--> statement-breakpoint
-- Turns the person's invitations into memberships, as Twake Tasks does, but
-- unlike Twake Tasks it moves the version of each wiki whose invitation it
-- takes: its members and invitations changed, which the people showing the
-- wiki reload, its sharing dialog open (ADR 012, Live updates). The sharing
-- routes lock the wiki's row first, as they move its version, then the rows
-- they change: the claim locks the rows of the wikis it is invited to first
-- too, in the order of their ids, else it would hold an invitation that an
-- admin changing it waits for, while it waited for that admin's wiki. In B2C a
-- person sees a wiki once a member only: app.claimed_wikis shows them those
-- wikis while it locks them, in USING only.
CREATE OR REPLACE FUNCTION app_claim_invites() RETURNS void
  LANGUAGE plpgsql
AS $$
DECLARE
  previous text := current_setting('app.membership_lookup', true);
  invited uuid[];
  claimed uuid[];
BEGIN
  SELECT array_agg(wiki_id ORDER BY wiki_id) INTO invited
  FROM wiki_invites
  WHERE email = lower(current_setting('app.user_email', true));
  IF invited IS NULL THEN
    RETURN;
  END IF;
  PERFORM set_config('app.claimed_wikis', invited::text, true);
  PERFORM 1 FROM wikis WHERE id = ANY(invited) ORDER BY id FOR NO KEY UPDATE;
  PERFORM set_config('app.claimed_wikis', '', true);
  PERFORM set_config('app.membership_lookup', 'on', true);
  WITH taken AS (
    DELETE FROM wiki_invites
    WHERE email = lower(current_setting('app.user_email', true))
      AND wiki_id = ANY(invited)
    RETURNING wiki_id, org_id, email, role
  ), added AS (
    INSERT INTO wiki_members (wiki_id, org_id, user_id, email, role)
    SELECT wiki_id, org_id, nullif(current_setting('app.user_id', true), '')::uuid, email, role
    FROM taken
    ON CONFLICT (wiki_id, user_id) DO NOTHING
  )
  SELECT array_agg(wiki_id) INTO claimed FROM taken;
  PERFORM set_config('app.membership_lookup', coalesce(previous, ''), true);
  UPDATE wikis SET version = version + 1
  WHERE id = ANY(claimed) AND deleted_at IS NULL;
END
$$;