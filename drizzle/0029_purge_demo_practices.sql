-- Purge the retired demo practices (owner request, 2026-09-26; ADR 0008). 0021/0022 only archived
-- them, so they still appeared as practices in the platform console. Their data is synthetic.
-- The audit log keeps every event: its links to tenants and users become plain IDs, and it stays
-- append-only (its immutability triggers are untouched).
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_tenant_id_tenants_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_user_id_users_id_fk";
--> statement-breakpoint

-- The append-only guards on practice tables would block the purge. They are lifted inside this
-- migration's transaction only and restored below.
ALTER TABLE "claim_versions" DISABLE TRIGGER "claim_versions_no_update";--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" DISABLE TRIGGER "custom_field_value_versions_no_update";--> statement-breakpoint
ALTER TABLE "remittances" DISABLE TRIGGER "remittances_no_delete";--> statement-breakpoint
ALTER TABLE "remittance_claims" DISABLE TRIGGER "remittance_claims_no_update";--> statement-breakpoint
ALTER TABLE "remittance_events" DISABLE TRIGGER "remittance_events_no_update";--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" DISABLE TRIGGER "prompt_pay_responses_no_update";--> statement-breakpoint
ALTER TABLE "tenant_agreements" DISABLE TRIGGER "tenant_agreements_guard_row";--> statement-breakpoint

-- Tenant by tenant, because FORCE row-level security hides rows from a non-superuser owner.
DO $$
DECLARE
  t uuid;
  purge_users uuid[];
BEGIN
  -- Users who belong to demo practices only (operators have no memberships and are never matched).
  SELECT coalesce(array_agg(user_id), '{}') INTO purge_users FROM (
    SELECT m.user_id FROM memberships m JOIN tenants x ON x.id = m.tenant_id
    GROUP BY m.user_id HAVING bool_and(x.kind = 'demo')
  ) demo_only;

  FOR t IN SELECT id FROM tenants WHERE kind = 'demo' LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    DELETE FROM custom_field_value_versions WHERE tenant_id = t;
    DELETE FROM custom_field_values WHERE tenant_id = t;
    DELETE FROM custom_fields WHERE tenant_id = t;
    DELETE FROM denial_notes WHERE tenant_id = t;
    DELETE FROM prompt_pay_responses WHERE tenant_id = t;
    DELETE FROM remittance_events WHERE tenant_id = t;
    DELETE FROM remittance_claims WHERE tenant_id = t;
    DELETE FROM denials WHERE tenant_id = t;
    DELETE FROM remittances WHERE tenant_id = t;
    DELETE FROM claim_versions WHERE tenant_id = t;
    DELETE FROM claim_lines WHERE tenant_id = t;
    DELETE FROM claims WHERE tenant_id = t;
    DELETE FROM patients WHERE tenant_id = t;
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
    DELETE FROM locations WHERE tenant_id = t;
    DELETE FROM providers WHERE tenant_id = t;
    DELETE FROM payers WHERE tenant_id = t;
    DELETE FROM tenant_agreements WHERE tenant_id = t;
    DELETE FROM sessions WHERE tenant_id = t;
    DELETE FROM memberships WHERE tenant_id = t;
    DELETE FROM tenants WHERE id = t;
    -- One record per purged practice (IDs only).
    INSERT INTO audit_events (action, tenant_id, entity_type, entity_id, metadata)
    VALUES ('system.demo_purged', t, 'tenant', t, '{"source": "migration_0029"}'::jsonb);
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);

  DELETE FROM sessions WHERE user_id = ANY (purge_users);
  DELETE FROM users WHERE id = ANY (purge_users);
END
$$;--> statement-breakpoint

ALTER TABLE "claim_versions" ENABLE TRIGGER "claim_versions_no_update";--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ENABLE TRIGGER "custom_field_value_versions_no_update";--> statement-breakpoint
ALTER TABLE "remittances" ENABLE TRIGGER "remittances_no_delete";--> statement-breakpoint
ALTER TABLE "remittance_claims" ENABLE TRIGGER "remittance_claims_no_update";--> statement-breakpoint
ALTER TABLE "remittance_events" ENABLE TRIGGER "remittance_events_no_update";--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ENABLE TRIGGER "prompt_pay_responses_no_update";--> statement-breakpoint
ALTER TABLE "tenant_agreements" ENABLE TRIGGER "tenant_agreements_guard_row";
