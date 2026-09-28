-- PI2a compliance review of the lifecycle slice (docs/specs/patient-integrations.md, "Withdraw"):
-- a connection withdrawn back to draft can have its endpoint edited and be submitted again, so the
-- U.S.-residency attestation on file must never carry over to the new submission. Two layers:
--   1. the app clears the attestation right after a withdraw (a separate UPDATE, because the
--      trigger below forbids changing it in the same statement that leaves pending_approval);
--   2. this migration makes the database refuse a Submit (draft -> pending_approval) unless both the
--      attestation and the submission stamp are fresh, i.e. different from the row's previous
--      values: the same fresh-stamp pattern 0040 uses for approval. A stale attestation from an
--      earlier submission can't be carried into a new one, whatever the app does.
-- Only integration_connections_lifecycle() changes (CREATE OR REPLACE; the trigger from 0039 keeps
-- pointing at it): 0040's body, plus the one new rule marked below.
--
-- Housekeeping: 0041's header cites drizzle/0020 for "no GRANT on sessions"; the accurate source is
-- drizzle/0002_security.sql, whose per-table GRANT list to denialdesk_app (business tables in a loop,
-- tenants, memberships, three users columns, audit_events) never includes `sessions`. 0041 has
-- already been applied to shared databases, so its text stays as it is and the citation is
-- corrected here. This migration changes no privilege.
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

    -- NEW in 0042 (PI2a compliance review): a submission needs a fresh attestation and a fresh
    -- submission stamp, not ones carried over from an earlier submission (for instance one left on
    -- a connection that was withdrawn, edited, and submitted again). The CHECK
    -- integration_connections_pending_requires_submission (0039) already requires both to be
    -- present (a missing stamp is refused by that CHECK, with its own message); this requires
    -- the stamps that are present to be new.
    IF OLD.status = 'draft' AND NEW.status = 'pending_approval' THEN
      IF (NEW.us_residency_attested_at IS NOT NULL
          AND NEW.us_residency_attested_at IS NOT DISTINCT FROM OLD.us_residency_attested_at)
         OR (NEW.submitted_at IS NOT NULL
             AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at) THEN
        RAISE EXCEPTION 'integration_connections %: submitting requires a fresh residency attestation and submission stamp', OLD.id;
      END IF;
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
$$;
