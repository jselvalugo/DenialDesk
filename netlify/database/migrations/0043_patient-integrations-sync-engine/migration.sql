-- Generated from drizzle/0043_patient_integrations_sync_engine.sql by `pnpm netlify:migrations`. Do not edit.
-- PI2b part 1: the sync engine and the synthetic sandbox (docs/specs/patient-integrations.md "PI2b";
-- ADR 0010; threat model T4, D4). Four changes, none of which adds a table:
--   1. integration_connections_lifecycle() stamps updated_at with the database's real clock on any
--      status change (function body only).
--   2. integration_connections_abandon_runs() also abandons queued/running runs on pause and error
--      (function body only; the trigger from 0039 keeps pointing at it).
--   3. Seeds the fixed integration service-principal `users` row that the sync engine writes as.
--   4. Replaces the sandbox CHECK from 0040 so the sandbox's discovered issuer can be pinned.
-- R-15.9: this migration adds NO GRANT, REVOKE, role, SECURITY DEFINER function, or RLS policy
-- change. Change 3 is an identity change (a `users` row) and is listed for owner sign-off in the PR.

-- 1. "Every writer of `error` stamps the transition in the database." The app's own transitions
-- write `updated_at = now()`, which is the *transaction's start*: a sync that goes active -> error at
-- the end of a long transaction would stamp a time before a Test connection pass recorded during that
-- transaction, and Resume's `afterLastChange` check (occurred_at > updated_at) would accept a pass
-- that preceded the error. clock_timestamp() is the actual wall clock at the moment of the change, so
-- every writer of `error` (the sync engine, or any other) gets it whatever it wrote itself. Body is
-- 0042's, plus the one statement marked below.
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
    -- NEW in 0043 (PI2b): the database's actual clock, not the transaction start (see above).
    NEW.updated_at := clock_timestamp();

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

    -- 0042 (PI2a compliance review): a submission needs a fresh attestation and a fresh
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
$$;--> statement-breakpoint

-- 2. Pause and error stop work already in flight: a connection leaving `active` abandons its queued
-- and running runs, as revoke has since 0039 (PI2a's Pause only stopped new runs from being queued).
-- The sync loop also re-checks `status = 'active'` before each page commit; this is the database
-- backstop. The engine that sets `error` itself finishes its own run as `failed` first, so this
-- never overwrites the engine's own result. Same search_path hardening as 0039.
CREATE OR REPLACE FUNCTION integration_connections_abandon_runs() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF NEW.status IN ('revoked', 'paused', 'error') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.integration_sync_runs
      SET status = 'abandoned', finished_at = now()
      WHERE connection_id = NEW.id AND status IN ('queued', 'running');
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint

-- 3. The integration service principal (spec "PI2b", `withTenantAsSystem`): the actor of every
-- audit event the sync engine writes and the `updated_by` of the connection and payer-mapping
-- rows it touches (both NOT NULL foreign keys to users). It cannot sign in: `password_hash` is not
-- a hash `verifyPassword` accepts (it fails closed on anything that is not `scrypt$...`), and the
-- account is disabled (`disabled_at`), which sign-in and every existing session check refuse. It
-- has no membership (so no role in any practice) and no MFA secret. The id is the constant
-- `INTEGRATION_SERVICE_PRINCIPAL_ID` in src/domain/integrations/principal.ts; a test pins both. The
-- `.invalid` address can never be a real mailbox or the operator's account.
INSERT INTO users (id, email, display_name, password_hash, disabled_at)
VALUES (
  'd3a7c0de-5a1c-4e11-8a0c-0000000d0d01',
  'integration-sync@service.denialdesk.invalid',
  'Integration sync (service principal)',
  '!',
  now()
)
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- 4. 0040 pinned a sandbox row's issuer to the string 'sandbox-client', but discovery records the
-- issuer as the normalized base URL (spec "Discovery"; the sandbox's CapabilityStatement carries no
-- implementation.url), so a passing Test connection could never pin it on a sandbox draft. The issuer
-- is NULL (not discovered yet) or the sandbox's own base URL; everything else in the constraint is
-- 0040's. Existing rows: no sandbox row could have a non-NULL issuer, so ADD CONSTRAINT validates.
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
      AND ("issuer" IS NULL OR "issuer" = 'https://sandbox.fhir.denialdesk.invalid/r4')
    )
  );
