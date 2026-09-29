-- Generated from drizzle/0047_appeal_letters.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TABLE "appeal_letter_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appeal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rendered_sha256" text NOT NULL,
	"attested_by" uuid NOT NULL,
	"attested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeal_letter_attestations_digest_shape" CHECK ("appeal_letter_attestations"."rendered_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "appeal_letter_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" "denial_category" NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeal_letter_templates_language_en" CHECK ("appeal_letter_templates"."language" = 'en'),
	CONSTRAINT "appeal_letter_templates_body_size" CHECK (length("appeal_letter_templates"."body") between 1 and 20000)
);
--> statement-breakpoint
CREATE TABLE "appeal_letter_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appeal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"source_category" "denial_category",
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeal_letter_versions_version_positive" CHECK ("appeal_letter_versions"."version" >= 1),
	CONSTRAINT "appeal_letter_versions_body_size" CHECK (length("appeal_letter_versions"."body") between 1 and 20000)
);
--> statement-breakpoint
ALTER TABLE "appeal_letter_attestations" ADD CONSTRAINT "appeal_letter_attestations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_attestations" ADD CONSTRAINT "appeal_letter_attestations_attested_by_users_id_fk" FOREIGN KEY ("attested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The composite FK below needs this unique key to exist first.
CREATE UNIQUE INDEX "appeal_letter_versions_key" ON "appeal_letter_versions" USING btree ("tenant_id","appeal_id","version");--> statement-breakpoint
ALTER TABLE "appeal_letter_attestations" ADD CONSTRAINT "appeal_letter_attestations_version_fk" FOREIGN KEY ("tenant_id","appeal_id","version") REFERENCES "public"."appeal_letter_versions"("tenant_id","appeal_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_templates" ADD CONSTRAINT "appeal_letter_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_templates" ADD CONSTRAINT "appeal_letter_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_templates" ADD CONSTRAINT "appeal_letter_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_versions" ADD CONSTRAINT "appeal_letter_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_versions" ADD CONSTRAINT "appeal_letter_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_versions" ADD CONSTRAINT "appeal_letter_versions_appeal_fk" FOREIGN KEY ("tenant_id","appeal_id") REFERENCES "public"."appeals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appeal_letter_attestations_lookup" ON "appeal_letter_attestations" USING btree ("tenant_id","appeal_id","version","attested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appeal_letter_templates_key" ON "appeal_letter_templates" USING btree ("tenant_id","category","language");--> statement-breakpoint

-- Appeal letters (docs/specs/appeals.md A2). Tenant isolation (R-7.2.4, CLAUDE.md #5): the same policy as
-- drizzle/0002_security.sql and 0029_appeals.sql. Isolation tests: test/integration/tenancy.test.ts.
-- Data classification: Restricted PHI by inheritance (HC-1.2: appeal letters and practice free text).
-- Grants follow the established pattern (table grants to denialdesk_app in the migration that creates the
-- table). The two history tables are append-only: SELECT, INSERT, and no UPDATE or DELETE.
ALTER TABLE "appeal_letter_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appeal_letter_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "appeal_letter_templates"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "appeal_letter_templates" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "appeal_letter_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appeal_letter_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "appeal_letter_versions"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "appeal_letter_versions" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "appeal_letter_attestations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appeal_letter_attestations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "appeal_letter_attestations"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "appeal_letter_attestations" TO denialdesk_app;--> statement-breakpoint

-- Append-only guards on the two history tables, like claim_versions in 0011. The app role already has no
-- UPDATE or DELETE grant; this also stops the schema owner. No SECURITY DEFINER.
CREATE OR REPLACE FUNCTION appeal_letter_history_immutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  RAISE EXCEPTION 'appeal letter history is append-only';
END
$$;--> statement-breakpoint
CREATE TRIGGER appeal_letter_versions_no_update BEFORE UPDATE OR DELETE ON "appeal_letter_versions"
  FOR EACH ROW EXECUTE FUNCTION appeal_letter_history_immutable();--> statement-breakpoint
CREATE TRIGGER appeal_letter_attestations_no_update BEFORE UPDATE OR DELETE ON "appeal_letter_attestations"
  FOR EACH ROW EXECUTE FUNCTION appeal_letter_history_immutable();--> statement-breakpoint

-- purge_demo_practices() (0032/0034/0038/0039) must know the new tables, or its DELETE FROM appeals would
-- fail on their foreign keys. This is the 0039 definition unchanged (LANGUAGE plpgsql, search_path pinned,
-- not SECURITY DEFINER; the REVOKE from 0032 stays in force on the replaced function) plus: the two new guards
-- disabled and re-enabled with the others, and the three new tables deleted (attestations, versions,
-- templates) before appeals.
CREATE OR REPLACE FUNCTION purge_demo_practices() RETURNS integer
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  t uuid;
  u record;
  purged integer := 0;
BEGIN
  -- Users who belong to demo practices only (operators have no memberships and are never matched).
  -- Each is recorded under one of its demo practices, so tenant-scoped audit reads can see it.
  CREATE TEMP TABLE purge_users ON COMMIT DROP AS
    SELECT m.user_id AS id, (array_agg(m.tenant_id ORDER BY m.tenant_id))[1] AS tenant_id
    FROM memberships m JOIN tenants x ON x.id = m.tenant_id
    GROUP BY m.user_id HAVING bool_and(x.kind = 'demo');

  -- The append-only guards on practice tables would block the purge; restored before returning.
  ALTER TABLE claim_versions DISABLE TRIGGER claim_versions_no_update;
  ALTER TABLE custom_field_value_versions DISABLE TRIGGER custom_field_value_versions_no_update;
  ALTER TABLE remittances DISABLE TRIGGER remittances_no_delete;
  ALTER TABLE remittance_claims DISABLE TRIGGER remittance_claims_no_update;
  ALTER TABLE remittance_events DISABLE TRIGGER remittance_events_no_update;
  ALTER TABLE prompt_pay_responses DISABLE TRIGGER prompt_pay_responses_no_update;
  ALTER TABLE tenant_agreements DISABLE TRIGGER tenant_agreements_guard_row;
  ALTER TABLE integration_sync_issues DISABLE TRIGGER integration_sync_issues_no_update;
  ALTER TABLE integration_sync_runs DISABLE TRIGGER integration_sync_runs_no_delete;
  ALTER TABLE appeal_letter_versions DISABLE TRIGGER appeal_letter_versions_no_update;
  ALTER TABLE appeal_letter_attestations DISABLE TRIGGER appeal_letter_attestations_no_update;

  -- Tenant by tenant, because FORCE row-level security hides rows from a non-superuser owner.
  FOR t IN SELECT id FROM tenants WHERE kind = 'demo' LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    DELETE FROM custom_field_value_versions WHERE tenant_id = t;
    DELETE FROM custom_field_values WHERE tenant_id = t;
    DELETE FROM custom_fields WHERE tenant_id = t;
    DELETE FROM appeal_letter_attestations WHERE tenant_id = t;
    DELETE FROM appeal_letter_versions WHERE tenant_id = t;
    DELETE FROM appeal_letter_templates WHERE tenant_id = t;
    DELETE FROM appeal_notes WHERE tenant_id = t;
    DELETE FROM appeals WHERE tenant_id = t;
    DELETE FROM denial_notes WHERE tenant_id = t;
    DELETE FROM prompt_pay_responses WHERE tenant_id = t;
    DELETE FROM remittance_events WHERE tenant_id = t;
    DELETE FROM remittance_claims WHERE tenant_id = t;
    DELETE FROM denials WHERE tenant_id = t;
    DELETE FROM remittances WHERE tenant_id = t;
    DELETE FROM claim_versions WHERE tenant_id = t;
    DELETE FROM claim_lines WHERE tenant_id = t;
    DELETE FROM claims WHERE tenant_id = t;
    DELETE FROM integration_sync_issues WHERE tenant_id = t;
    DELETE FROM integration_sync_runs WHERE tenant_id = t;
    DELETE FROM integration_payer_mappings WHERE tenant_id = t;
    DELETE FROM patients WHERE tenant_id = t;
    DELETE FROM integration_endpoint_registry
      WHERE connection_id IN (SELECT id FROM integration_connections WHERE tenant_id = t);
    DELETE FROM integration_connections WHERE tenant_id = t;
    DELETE FROM payer_classes WHERE tenant_id = t;
    DELETE FROM rcm_journal_lines WHERE tenant_id = t;
    DELETE FROM rcm_journal_vouchers WHERE tenant_id = t;
    DELETE FROM rcm_claim_lines WHERE tenant_id = t;
    DELETE FROM rcm_deposits WHERE tenant_id = t;
    DELETE FROM rcm_deposit_files WHERE tenant_id = t;
    DELETE FROM rcm_files WHERE tenant_id = t;
    DELETE FROM rcm_sites WHERE tenant_id = t;
    DELETE FROM gl_accounts WHERE tenant_id = t;
    DELETE FROM business_rules WHERE tenant_id = t;
    DELETE FROM university_progress WHERE tenant_id = t;
    DELETE FROM university_access WHERE tenant_id = t;
    DELETE FROM practice_settings WHERE tenant_id = t;
    DELETE FROM locations WHERE tenant_id = t;
    DELETE FROM providers WHERE tenant_id = t;
    DELETE FROM payers WHERE tenant_id = t;
    DELETE FROM tenant_agreements WHERE tenant_id = t;
    DELETE FROM sessions WHERE tenant_id = t;
    DELETE FROM memberships WHERE tenant_id = t;
    DELETE FROM tenants WHERE id = t;
    -- One record per purged practice (IDs only; no actor: run by a migration).
    INSERT INTO audit_events (action, tenant_id, entity_type, entity_id, metadata)
    VALUES ('system.demo_purged', t, 'tenant', t,
            '{"source": "migration_0032", "reason": "owner_request", "adr": "0008"}'::jsonb);
    purged := purged + 1;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);

  FOR u IN SELECT id, tenant_id FROM purge_users LOOP
    DELETE FROM sessions WHERE user_id = u.id;
    DELETE FROM users WHERE id = u.id;
    INSERT INTO audit_events (action, tenant_id, entity_type, entity_id, metadata)
    VALUES ('system.demo_user_purged', u.tenant_id, 'user', u.id,
            '{"source": "migration_0032", "reason": "owner_request", "adr": "0008"}'::jsonb);
  END LOOP;

  ALTER TABLE claim_versions ENABLE TRIGGER claim_versions_no_update;
  ALTER TABLE custom_field_value_versions ENABLE TRIGGER custom_field_value_versions_no_update;
  ALTER TABLE remittances ENABLE TRIGGER remittances_no_delete;
  ALTER TABLE remittance_claims ENABLE TRIGGER remittance_claims_no_update;
  ALTER TABLE remittance_events ENABLE TRIGGER remittance_events_no_update;
  ALTER TABLE prompt_pay_responses ENABLE TRIGGER prompt_pay_responses_no_update;
  ALTER TABLE tenant_agreements ENABLE TRIGGER tenant_agreements_guard_row;
  ALTER TABLE integration_sync_issues ENABLE TRIGGER integration_sync_issues_no_update;
  ALTER TABLE integration_sync_runs ENABLE TRIGGER integration_sync_runs_no_delete;
  ALTER TABLE appeal_letter_versions ENABLE TRIGGER appeal_letter_versions_no_update;
  ALTER TABLE appeal_letter_attestations ENABLE TRIGGER appeal_letter_attestations_no_update;
  DROP TABLE purge_users;
  RETURN purged;
END
$$;
