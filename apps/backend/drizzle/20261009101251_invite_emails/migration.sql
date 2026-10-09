CREATE TABLE "invite_emails" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"wiki_id" uuid NOT NULL,
	"org_id" text,
	"email" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"tenant" text GENERATED ALWAYS AS (coalesce(org_id, '')) STORED NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invite_emails" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- The app role owns its tables, so the policies only bind it when forced.
ALTER TABLE "invite_emails" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "invite_emails_wiki_id_email_sent_at_index" ON "invite_emails" ("wiki_id","email","sent_at");--> statement-breakpoint
CREATE INDEX "invite_emails_invited_by_sent_at_index" ON "invite_emails" ("invited_by","sent_at");--> statement-breakpoint
ALTER TABLE "invite_emails" ADD CONSTRAINT "invite_emails_wiki_id_wikis_id_fkey" FOREIGN KEY ("wiki_id") REFERENCES "wikis"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invite_emails" ADD CONSTRAINT "invite_emails_tenant_wiki_id_wikis_tenant_id_fkey" FOREIGN KEY ("tenant","wiki_id") REFERENCES "wikis"("tenant","id");--> statement-breakpoint
CREATE POLICY "tenant" ON "invite_emails" AS PERMISSIVE FOR ALL TO public USING ("invite_emails"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("invite_emails"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "invite_emails"."wiki_id"))) WITH CHECK ("invite_emails"."org_id" is not distinct from nullif(current_setting('app.org_id', true), '') and ("invite_emails"."org_id" is not null or exists (select 1 from "wikis" where "wikis"."id" = "invite_emails"."wiki_id")));