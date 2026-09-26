-- Generated from drizzle/0003_review_fixes.sql by `pnpm netlify:migrations`. Do not edit.
ALTER TABLE "audit_events" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "denials" ADD COLUMN "appeal_submitted_on" date;