-- Generated from drizzle/0040_patient_integrations_review_polish.sql by `pnpm netlify:migrations`. Do not edit.
-- Custom SQL migration file, put your code below! --
-- PI1a final review polish (docs/specs/patient-integrations.md "PI1a"; ADR 0010).
--
-- 0039 was already applied to Netlify's per-branch preview database for this PR before these
-- fixes were made, so it is now immutable there (see docs/PROJECT_STATE.md "Lessons /
-- conventions learned"). These are the same fixes that were briefly hand-edited into 0039 itself
-- (commit 1efe153), moved here as a proper follow-up migration instead.

-- 1. Security review (final round, Medium): pin the whole sandbox endpoint identity, not just
-- base_url/endpoint_key, so a sandbox row can't carry a real token endpoint, issuer, or client ID
-- either — token_endpoint/token_endpoint_key/issuer are nullable (never discovered for the
-- in-process sandbox) but client_id is NOT NULL, so it must equal the fixed sandbox client ID.
ALTER TABLE "integration_connections" DROP CONSTRAINT "integration_connections_sandbox_is_builtin";--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_sandbox_is_builtin"
  CHECK (
    NOT "is_sandbox"
    OR (
      "base_url" = 'https://sandbox.fhir.denialdesk.invalid/r4'
      AND "endpoint_key" = 'https://sandbox.fhir.denialdesk.invalid/r4'
      AND "client_id" = 'sandbox-client'
      AND ("token_endpoint" IS NULL OR "token_endpoint" = 'https://sandbox.fhir.denialdesk.invalid/token')
      AND ("token_endpoint_key" IS NULL OR "token_endpoint_key" = 'https://sandbox.fhir.denialdesk.invalid/token')
      AND ("issuer" IS NULL OR "issuer" = 'sandbox-client')
    )
  );--> statement-breakpoint

-- 2. Compliance review (final round): patients_synced_readonly's INSERT branch now also refuses a
-- fhir row unless sensitivity_tags = '{}' — sensitivity tags are always practice-set, never
-- carried in from the EHR/PM, not even on the very first insert of a synced row. Reproduced in full
-- (CREATE OR REPLACE) since PostgreSQL has no ALTER FUNCTION for a function body.
CREATE OR REPLACE FUNCTION patients_synced_readonly() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  set_run_id uuid;
  set_connection_id uuid;
  run_status text;
  run_connection_id uuid;
  run_tenant_id uuid;
  run_connection_status text;
BEGIN
  set_run_id := nullif(current_setting('app.sync_run_id', true), '')::uuid;
  set_connection_id := nullif(current_setting('app.sync_connection_id', true), '')::uuid;

  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'fhir' THEN
      IF set_run_id IS NULL OR set_connection_id IS NULL
         OR NEW.source_connection_id IS DISTINCT FROM set_connection_id THEN
        RAISE EXCEPTION 'patients: a synced row can only be inserted by a running sync run';
      END IF;
      SELECT r.status, r.connection_id, r.tenant_id, c.status
        INTO run_status, run_connection_id, run_tenant_id, run_connection_status
        FROM public.integration_sync_runs r JOIN public.integration_connections c ON c.id = r.connection_id
        WHERE r.id = set_run_id;
      IF run_status IS DISTINCT FROM 'running' OR run_connection_id IS DISTINCT FROM set_connection_id
         OR run_tenant_id IS DISTINCT FROM NEW.tenant_id OR run_connection_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'patients: a synced row can only be inserted by a running sync run';
      END IF;
      -- Compliance review (final round): sensitivity tags are practice-owned; a sync never sets
      -- them, not even on the very first insert of a synced row.
      IF NEW.sensitivity_tags IS DISTINCT FROM '{}'::text[] THEN
        RAISE EXCEPTION 'patients: a synced row cannot be inserted with sensitivity tags set';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Compliance review #2: sensitivity tags never change while a sync run's settings are in effect,
  -- regardless of source — they are practice-owned and a sync should never touch them.
  IF set_run_id IS NOT NULL AND NEW.sensitivity_tags IS DISTINCT FROM OLD.sensitivity_tags THEN
    RAISE EXCEPTION 'patients %: sensitivity tags cannot change during a sync run', OLD.id;
  END IF;

  IF OLD.source = 'fhir' AND NEW.source = 'manual' THEN
    RAISE EXCEPTION 'patients %: a synced patient cannot become manual', OLD.id;
  END IF;

  -- Identity/linking change (a manual row may only become a synced one, or a synced row point at
  -- a different external id, from inside a running run of the connection it is joining).
  IF NEW.source IS DISTINCT FROM OLD.source
     OR NEW.source_connection_id IS DISTINCT FROM OLD.source_connection_id
     OR NEW.external_id IS DISTINCT FROM OLD.external_id
  THEN
    IF set_run_id IS NULL OR set_connection_id IS NULL
       OR NEW.source_connection_id IS DISTINCT FROM set_connection_id THEN
      RAISE EXCEPTION 'patients %: synced fields can only change during a running sync run', OLD.id;
    END IF;
    SELECT r.status, r.connection_id, r.tenant_id, c.status
      INTO run_status, run_connection_id, run_tenant_id, run_connection_status
      FROM public.integration_sync_runs r JOIN public.integration_connections c ON c.id = r.connection_id
      WHERE r.id = set_run_id;
    IF run_status IS DISTINCT FROM 'running' OR run_connection_id IS DISTINCT FROM set_connection_id
       OR run_tenant_id IS DISTINCT FROM NEW.tenant_id OR run_connection_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'patients %: synced fields can only change during a running sync run', OLD.id;
    END IF;
  END IF;

  -- A row already synced (OLD.source = 'fhir') keeps its billing-minimum columns read-only outside
  -- a running run of its own connection. A manual row (never synced) is unaffected: these are
  -- ordinary editable fields until it is linked above.
  IF OLD.source = 'fhir' AND (
     NEW.mrn IS DISTINCT FROM OLD.mrn
     OR NEW.first_name IS DISTINCT FROM OLD.first_name
     OR NEW.last_name IS DISTINCT FROM OLD.last_name
     OR NEW.birth_date IS DISTINCT FROM OLD.birth_date
     OR NEW.sex IS DISTINCT FROM OLD.sex
     OR NEW.address_line1 IS DISTINCT FROM OLD.address_line1
     OR NEW.city IS DISTINCT FROM OLD.city
     OR NEW.state IS DISTINCT FROM OLD.state
     OR NEW.postal_code IS DISTINCT FROM OLD.postal_code
     OR NEW.primary_payer_id IS DISTINCT FROM OLD.primary_payer_id
     OR NEW.member_id_enc IS DISTINCT FROM OLD.member_id_enc
     OR NEW.member_id_last4 IS DISTINCT FROM OLD.member_id_last4
     OR NEW.coverage_status IS DISTINCT FROM OLD.coverage_status
     OR NEW.coverage_payor_key IS DISTINCT FROM OLD.coverage_payor_key
     OR NEW.source_status IS DISTINCT FROM OLD.source_status
     OR NEW.source_restricted IS DISTINCT FROM OLD.source_restricted
     OR NEW.source_sensitivity IS DISTINCT FROM OLD.source_sensitivity
     OR NEW.source_version_id IS DISTINCT FROM OLD.source_version_id
     OR NEW.source_last_updated IS DISTINCT FROM OLD.source_last_updated
     OR NEW.synced_at IS DISTINCT FROM OLD.synced_at
  ) THEN
    IF set_run_id IS NULL OR set_connection_id IS NULL
       OR OLD.source_connection_id IS DISTINCT FROM set_connection_id THEN
      RAISE EXCEPTION 'patients %: synced fields can only change during a running sync run', OLD.id;
    END IF;
    SELECT r.status, r.connection_id, r.tenant_id, c.status
      INTO run_status, run_connection_id, run_tenant_id, run_connection_status
      FROM public.integration_sync_runs r JOIN public.integration_connections c ON c.id = r.connection_id
      WHERE r.id = set_run_id;
    IF run_status IS DISTINCT FROM 'running' OR run_connection_id IS DISTINCT FROM set_connection_id
       OR run_tenant_id IS DISTINCT FROM OLD.tenant_id OR run_connection_status IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'patients %: synced fields can only change during a running sync run', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint

-- 3. Security review (final round, Low): integration_connections_lifecycle's
-- pending_approval -> active branch now also requires a matching integration_endpoint_registry
-- row for a non-sandbox connection — otherwise two practices could both be "active" against the
-- same real EHR registration, which the registry exists to prevent. Also schema-qualifies its one
-- table lookup with SET search_path = pg_catalog, public, pg_temp (pg_temp last), matching every
-- other definer/trigger function in 0039 that reads a table.
CREATE OR REPLACE FUNCTION integration_connections_lifecycle() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF OLD.status = 'revoked' THEN
    RAISE EXCEPTION 'integration_connections %: revoked is terminal', OLD.id;
  END IF;

  IF NEW.is_sandbox IS DISTINCT FROM OLD.is_sandbox THEN
    RAISE EXCEPTION 'integration_connections %: is_sandbox cannot change', OLD.id;
  END IF;

  IF OLD.has_synced AND NOT NEW.has_synced THEN
    RAISE EXCEPTION 'integration_connections %: has_synced cannot be unset', OLD.id;
  END IF;

  IF OLD.has_synced AND (
    NEW.base_url IS DISTINCT FROM OLD.base_url
    OR NEW.endpoint_key IS DISTINCT FROM OLD.endpoint_key
    OR NEW.token_endpoint IS DISTINCT FROM OLD.token_endpoint
    OR NEW.token_endpoint_key IS DISTINCT FROM OLD.token_endpoint_key
    OR NEW.issuer IS DISTINCT FROM OLD.issuer
    OR NEW.mrn_identifier_system IS DISTINCT FROM OLD.mrn_identifier_system
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
  ) THEN
    RAISE EXCEPTION 'integration_connections %: endpoint fields are immutable once synced', OLD.id;
  END IF;

  -- Security review H2 / compliance B1 / correctness B2: the whole endpoint set (plus the
  -- residency attestation, which is meaningless once submitted) may only change while still draft,
  -- whether or not status also changes in this same statement.
  IF OLD.status IS DISTINCT FROM 'draft' AND (
    NEW.base_url IS DISTINCT FROM OLD.base_url
    OR NEW.endpoint_key IS DISTINCT FROM OLD.endpoint_key
    OR NEW.token_endpoint IS DISTINCT FROM OLD.token_endpoint
    OR NEW.token_endpoint_key IS DISTINCT FROM OLD.token_endpoint_key
    OR NEW.issuer IS DISTINCT FROM OLD.issuer
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.mrn_identifier_system IS DISTINCT FROM OLD.mrn_identifier_system
    OR NEW.us_residency_attested_by IS DISTINCT FROM OLD.us_residency_attested_by
    OR NEW.us_residency_attested_at IS DISTINCT FROM OLD.us_residency_attested_at
  ) THEN
    RAISE EXCEPTION 'integration_connections %: the endpoint can only change while draft', OLD.id;
  END IF;

  -- While awaiting approval, only the display name and the transition itself may change; the
  -- endpoint set is already locked by the check above, so this covers the remaining bookkeeping
  -- columns a sync could otherwise sneak in before the connection is even approved.
  IF OLD.status = 'pending_approval' AND (
    NEW.patient_watermark IS DISTINCT FROM OLD.patient_watermark
    OR NEW.coverage_watermark IS DISTINCT FROM OLD.coverage_watermark
    OR NEW.last_success_at IS DISTINCT FROM OLD.last_success_at
    OR NEW.bulk_group_id IS DISTINCT FROM OLD.bulk_group_id
    OR NEW.has_synced IS DISTINCT FROM OLD.has_synced
  ) THEN
    RAISE EXCEPTION 'integration_connections %: only the display name can change while pending approval', OLD.id;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status = 'pending_approval' AND NOT NEW.is_sandbox)
      OR (OLD.status = 'draft' AND NEW.status = 'active' AND NEW.is_sandbox)
      OR (OLD.status = 'draft' AND NEW.status = 'revoked')
      OR (OLD.status = 'pending_approval' AND NEW.status = 'active')
      OR (OLD.status = 'pending_approval' AND NEW.status = 'draft')
      OR (OLD.status = 'pending_approval' AND NEW.status = 'revoked')
      OR (OLD.status = 'active' AND NEW.status = 'paused')
      OR (OLD.status = 'active' AND NEW.status = 'error')
      OR (OLD.status = 'active' AND NEW.status = 'revoked')
      OR (OLD.status = 'paused' AND NEW.status = 'active')
      OR (OLD.status = 'paused' AND NEW.status = 'revoked')
      OR (OLD.status = 'error' AND NEW.status = 'active')
      OR (OLD.status = 'error' AND NEW.status = 'revoked')
    ) THEN
      RAISE EXCEPTION 'integration_connections_lifecycle: % -> % is not allowed', OLD.status, NEW.status;
    END IF;

    IF OLD.status = 'pending_approval' AND NEW.status = 'active' THEN
      -- Security review M5: enforced on data, not only the role name — a fresh approval stamp,
      -- not one merely carried over unchanged from an earlier state.
      IF current_user = 'denialdesk_app' THEN
        RAISE EXCEPTION 'integration_connections %: only the platform operator may activate a pending connection', OLD.id;
      END IF;
      IF NEW.approved_by IS NULL OR NEW.approved_at IS NULL
         OR NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at THEN
        RAISE EXCEPTION 'integration_connections %: activation requires a fresh approval', OLD.id;
      END IF;
      -- Security review (final round, Low): a non-sandbox connection can't go live without having
      -- claimed the global endpoint registry first — otherwise two practices could both be "active"
      -- against the same real EHR registration, which the registry exists to prevent.
      IF NOT NEW.is_sandbox AND NOT EXISTS (
        SELECT 1 FROM public.integration_endpoint_registry WHERE connection_id = OLD.id
      ) THEN
        RAISE EXCEPTION 'integration_connections %: activation requires a registry entry', OLD.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint
