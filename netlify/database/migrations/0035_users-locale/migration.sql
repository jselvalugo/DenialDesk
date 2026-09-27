-- Generated from drizzle/0035_users_locale.sql by `pnpm netlify:migrations`. Do not edit.
ALTER TABLE "users" ADD COLUMN "locale" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_locale_check" CHECK ("users"."locale" is null or "users"."locale" in ('en', 'es', 'pt'));