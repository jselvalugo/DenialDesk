-- Generated from drizzle/0020_remove_demo.sql by `pnpm netlify:migrations`. Do not edit.
-- The one-click demo practice was removed (owner request, 2026-09-26). Archive any live demo
-- practice (never deleted: the audit trail references it) and end leftover demo sessions.
UPDATE "tenants" SET "suspended_at" = now() WHERE "kind" = 'demo' AND "suspended_at" IS NULL;--> statement-breakpoint
UPDATE "sessions" SET "revoked_at" = now() WHERE "auth_method" = 'demo' AND "revoked_at" IS NULL;
