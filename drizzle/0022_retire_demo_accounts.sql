-- Demo removal follow-up (security/compliance review of PR #34, 2026-09-26).
-- Users whose only memberships are in (archived) demo practices can never sign in again: disable
-- them, so reactivating a demo practice by any route can't bring those accounts back.
UPDATE "users" SET "disabled_at" = now()
WHERE "disabled_at" IS NULL
  AND "id" IN (
    SELECT m."user_id" FROM "memberships" m JOIN "tenants" t ON t."id" = m."tenant_id"
    GROUP BY m."user_id" HAVING bool_and(t."kind" = 'demo')
  );--> statement-breakpoint
-- One audit record per retired demo practice, so the bulk archive in 0021 has a trail (IDs only).
INSERT INTO "audit_events" ("action", "tenant_id", "entity_type", "entity_id", "metadata")
SELECT 'system.demo_retired', t."id", 'tenant', t."id", '{"source": "migration_0021_0022"}'::jsonb
FROM "tenants" t WHERE t."kind" = 'demo'
  -- Idempotent: never a second record for a practice already recorded as retired.
  AND NOT EXISTS (
    SELECT 1 FROM "audit_events" a WHERE a."action" = 'system.demo_retired' AND a."tenant_id" = t."id"
  );
