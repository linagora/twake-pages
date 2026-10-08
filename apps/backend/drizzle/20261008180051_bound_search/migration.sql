-- A tsvector keeps at most 1 MiB of distinct words, which 2 MiB of blocks can
-- pass. The densest text found, hyphenated words of 4-byte letters, which
-- search keeps whole and in parts, takes under 8 bytes a character, so search
-- reads the first 100 000 characters of the text. Postgres 16 cannot change
-- the expression of a generated column, so the column and its index are made
-- again, still not null.
ALTER TABLE "pages" DROP COLUMN "search";--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (setweight(to_tsvector('simple', "title"), 'A') || setweight(to_tsvector('simple', left("text", 100000)), 'B')) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "pages_search_index" ON "pages" USING gin ("search");
