-- Generated from drizzle/0019_operator_credentials.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TABLE "operator_credentials" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone
);
