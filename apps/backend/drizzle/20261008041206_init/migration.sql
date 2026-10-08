CREATE TYPE "theme" AS ENUM('light', 'dark', 'auto');--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outbox_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"event" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"consumer" text,
	"source" text,
	"id" text,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "processed_events_pkey" PRIMARY KEY("consumer","source","id")
);
--> statement-breakpoint
CREATE TABLE "oidc_revoked_sessions" (
	"sid" text PRIMARY KEY,
	"revoked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"email" text PRIMARY KEY,
	"version" integer NOT NULL,
	"language" text,
	"timezone" text,
	"theme" "theme",
	"avatar" text,
	"name" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"kind" text NOT NULL,
	"key" text UNIQUE,
	"payload" jsonb NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "outbox_sent_at_id_index" ON "outbox" ("sent_at","id");--> statement-breakpoint
CREATE INDEX "oidc_revoked_sessions_expires_at_index" ON "oidc_revoked_sessions" ("expires_at");--> statement-breakpoint
CREATE INDEX "jobs_run_at_index" ON "jobs" ("run_at");