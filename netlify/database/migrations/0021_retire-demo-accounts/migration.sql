-- Generated from drizzle/0021_retire_demo_accounts.sql by `pnpm netlify:migrations`. Do not edit.
-- Demo removal follow-up (security/compliance review of PR #34, 2026-09-26).
-- Users whose only memberships are in (archived) demo practices can never sign in again: disable
-- them, so reactivating a demo practice by any route can't bring those accounts back.
UPDATE "users" SET "disabled_at" = now()
WHERE "disabled_at" IS NULL
  AND "id" IN (
    SELECT m."user_id" FROM "memberships" m JOIN "tenants" t ON t."id" = m."tenant_id"
    GROUP BY m."user_id" HAVING bool_and(t."kind" = 'demo')
  );--> statement-breakpoint
-- One audit record per retired demo practice, so the bulk archive in 0020 has a trail (IDs only).
INSERT INTO "audit_events" ("action", "tenant_id", "entity_type", "entity_id", "metadata")
SELECT 'system.demo_retired', "id", 'tenant', "id", '{"source": "migration_0020_0021"}'::jsonb
FROM "tenants" WHERE "kind" = 'demo';
