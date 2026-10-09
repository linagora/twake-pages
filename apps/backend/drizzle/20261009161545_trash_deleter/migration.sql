-- The trash names whoever deleted each branch, with their email and name,
-- which stay when they leave the wiki, as a version keeps its author's. No
-- route put a page in the trash before, so no row lacks them.
ALTER TABLE "pages" ADD COLUMN "deleted_by_email" text;--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "deleted_by_name" text;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_deleter" CHECK (("deleted_at" is null) = ("deleted_by" is null) and ("deleted_at" is null) = ("deleted_by_email" is null));