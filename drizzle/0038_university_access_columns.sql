-- Practice sessions may read the state of their access row but not the operator's internal
-- fields (note: order/invoice reference; revoke reason; who granted/revoked). Replaces the
-- table-level SELECT from 0037 with a column list (security review, 2026-09-27).
REVOKE SELECT ON "university_access" FROM denialdesk_app;--> statement-breakpoint
GRANT SELECT ("id", "tenant_id", "requested_at", "requested_by", "granted_at", "revoked_at", "created_at", "updated_at")
  ON "university_access" TO denialdesk_app;--> statement-breakpoint

-- purge_demo_practices() (0034) predates university_access (0037), whose foreign keys to tenants
-- and users would make a purge fail for a demo practice with a row. Same function, one more DELETE.
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

  -- Tenant by tenant, because FORCE row-level security hides rows from a non-superuser owner.
  FOR t IN SELECT id FROM tenants WHERE kind = 'demo' LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    DELETE FROM custom_field_value_versions WHERE tenant_id = t;
    DELETE FROM custom_field_values WHERE tenant_id = t;
    DELETE FROM custom_fields WHERE tenant_id = t;
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
  DROP TABLE purge_users;
  RETURN purged;
END
$$;
