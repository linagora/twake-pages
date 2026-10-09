ALTER POLICY "tenant" ON "invite_emails" TO public USING ("invite_emails"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("invite_emails"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "invite_emails"."wiki_id") or "invite_emails"."invited_by" = nullif(current_setting('app.leaving_user', true), '')::uuid or "invite_emails"."email" in (select lower("wiki_members"."email") from "wiki_members" where "wiki_members"."user_id" = nullif(current_setting('app.leaving_user', true), '')::uuid))) WITH CHECK ("invite_emails"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("invite_emails"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "invite_emails"."wiki_id")));--> statement-breakpoint
-- A deleted account loses the invitation emails it sent, or that hold one of
-- its emails, those of the wikis a B2C tenant hides from it too: the wikis it
-- left, or was invited to and never joined. Unlike Twake Tasks, which deletes
-- them as the tenant, and so keeps those. The tenant policy of invite_emails
-- shows them in USING only, under app.leaving_user. The person's emails are
-- those of their memberships, which the deletion of the account takes after.
CREATE OR REPLACE FUNCTION app_forget_user(person uuid) RETURNS void
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
  DELETE FROM invite_emails
    WHERE invited_by = person
      OR email IN (SELECT lower(email) FROM wiki_members WHERE user_id = person);
  PERFORM set_config('app.leaving_user', coalesce(previous, ''), true);
END
$$;