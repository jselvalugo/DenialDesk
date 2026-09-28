-- Generated from drizzle/0039_patient_integrations_data_layer.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TYPE "public"."integration_connection_status" AS ENUM('draft', 'pending_approval', 'active', 'paused', 'error', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."integration_sync_run_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."patient_source" AS ENUM('manual', 'fhir');--> statement-breakpoint
CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"target_table" text DEFAULT 'patients' NOT NULL,
	"kind" text DEFAULT 'fhir_r4' NOT NULL,
	"is_sandbox" boolean DEFAULT false NOT NULL,
	"display_name" text NOT NULL,
	"base_url" text NOT NULL,
	"endpoint_key" text NOT NULL,
	"token_endpoint" text,
	"token_endpoint_key" text,
	"issuer" text,
	"client_id" text NOT NULL,
	"mrn_identifier_system" text NOT NULL,
	"mrn_nine_digits_verified" boolean DEFAULT false NOT NULL,
	"key_mode" text,
	"key_ref" text,
	"key_exception_reason" text,
	"status" "integration_connection_status" DEFAULT 'draft' NOT NULL,
	"status_reason" text,
	"population_scope" text,
	"us_residency_attested_by" uuid,
	"us_residency_attested_at" timestamp with time zone,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"approval_method" text,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"patient_watermark" timestamp with time zone,
	"coverage_watermark" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"bulk_group_id" text,
	"has_synced" boolean DEFAULT false NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_endpoint_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"endpoint_key" text NOT NULL,
	"client_id" text NOT NULL,
	"token_endpoint_key" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_payer_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"payor_key" text NOT NULL,
	"payor_name" text,
	"payer_id" uuid,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"code" text NOT NULL,
	"patient_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"triggered_by" uuid,
	"status" "integration_sync_run_status" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"patient_watermark" timestamp with time zone,
	"coverage_watermark" timestamp with time zone,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"linked_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"issue_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"http_status" integer
);
--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "member_id_enc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "member_id_last4" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "source" "patient_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "source_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "source_version_id" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "source_last_updated" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "source_status" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "source_restricted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "source_sensitivity" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "coverage_status" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "coverage_payor_key" text;--> statement-breakpoint
-- Created ahead of the foreign keys below that target them (composite tenant-scoped FKs need the
-- unique index to exist first).
CREATE UNIQUE INDEX "integration_connections_tenant_id_key" ON "integration_connections" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_runs_tenant_id_key" ON "integration_sync_runs" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_tenant_id_key" ON "patients" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_us_residency_attested_by_users_id_fk" FOREIGN KEY ("us_residency_attested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_endpoint_registry" ADD CONSTRAINT "integration_endpoint_registry_connection_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_payer_mappings" ADD CONSTRAINT "integration_payer_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_payer_mappings" ADD CONSTRAINT "integration_payer_mappings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_payer_mappings" ADD CONSTRAINT "integration_payer_mappings_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."integration_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_payer_mappings" ADD CONSTRAINT "integration_payer_mappings_payer_fk" FOREIGN KEY ("tenant_id","payer_id") REFERENCES "public"."payers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_issues" ADD CONSTRAINT "integration_sync_issues_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_issues" ADD CONSTRAINT "integration_sync_issues_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."integration_sync_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_issues" ADD CONSTRAINT "integration_sync_issues_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_connection_fk" FOREIGN KEY ("tenant_id","connection_id") REFERENCES "public"."integration_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_one_active" ON "integration_connections" USING btree ("tenant_id","target_table") WHERE status not in ('draft', 'revoked');--> statement-breakpoint
CREATE UNIQUE INDEX "integration_endpoint_registry_connection_key" ON "integration_endpoint_registry" USING btree ("connection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_endpoint_registry_endpoint_key" ON "integration_endpoint_registry" USING btree ("endpoint_key","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_endpoint_registry_token_endpoint_key" ON "integration_endpoint_registry" USING btree ("token_endpoint_key","client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_payer_mappings_tenant_connection_payor_key" ON "integration_payer_mappings" USING btree ("tenant_id","connection_id","payor_key");--> statement-breakpoint
CREATE INDEX "integration_sync_issues_run_idx" ON "integration_sync_issues" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE INDEX "integration_sync_runs_connection_idx" ON "integration_sync_runs" USING btree ("tenant_id","connection_id","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_sync_runs_one_active" ON "integration_sync_runs" USING btree ("tenant_id","connection_id") WHERE status in ('queued', 'running');--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_source_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."integration_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "patients_tenant_connection_external_key" ON "patients" USING btree ("tenant_id","source_connection_id","external_id") WHERE source = 'fhir';--> statement-breakpoint

-- Field shapes (checked here as well as by the app that will write them, PI1b/PI1c/PI2a). Only
-- "patients" and "fhir_r4" exist today (ADR 0010); target_table/kind stay text for a future connector.
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_target_table_valid"
  CHECK ("target_table" = 'patients');--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_kind_valid"
  CHECK ("kind" = 'fhir_r4');--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_key_mode_valid"
  CHECK ("key_mode" IS NULL OR "key_mode" IN ('per_connection', 'shared_vendor_exception', 'preprod_shared'));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_population_scope_valid"
  CHECK ("population_scope" IS NULL OR "population_scope" IN ('group_export', 'verified_filter'));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_display_name_present"
  CHECK (length(btrim("display_name")) BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_base_url_present"
  CHECK (length(btrim("base_url")) > 0);--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_client_id_present"
  CHECK (length(btrim("client_id")) BETWEEN 1 AND 255);--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_mrn_system_present"
  CHECK (length(btrim("mrn_identifier_system")) > 0);--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_status_reason_format"
  CHECK ("status_reason" IS NULL OR "status_reason" ~ '^[a-z_]{1,64}$');--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_attested_fields_together"
  CHECK (("us_residency_attested_at" IS NULL) = ("us_residency_attested_by" IS NULL));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_submitted_fields_together"
  CHECK (("submitted_at" IS NULL) = ("submitted_by" IS NULL));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_approved_fields_together"
  CHECK (("approved_at" IS NULL) = ("approved_by" IS NULL));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_revoked_fields_together"
  CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL));--> statement-breakpoint

-- Security review H1: the built-in synthetic sandbox is one fixed endpoint (spec "Synthetic
-- sandbox"); a sandbox row can never point at a real host, so "is_sandbox" can never be used to
-- dodge operator approval or the SSRF guard for a real endpoint. Final review: pin the whole
-- endpoint identity (not just base_url/endpoint_key) so a sandbox row can't carry a real token
-- endpoint, issuer, or client ID either — token_endpoint/token_endpoint_key/issuer are nullable
-- (never discovered for the in-process sandbox) but client_id is NOT NULL, so it must equal the
-- fixed sandbox client ID.
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
-- Security review H1/N5: a real (non-sandbox) connection cannot be live without a recorded
-- operator approval, method, and population scope; a sandbox connection never needs one.
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_approved_when_live"
  CHECK (
    "is_sandbox"
    OR "status" NOT IN ('active', 'paused', 'error')
    OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL AND "approval_method" IS NOT NULL AND "population_scope" IS NOT NULL)
  );--> statement-breakpoint
-- N5: submitting for approval requires the attestation and the submission stamp together.
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_pending_requires_submission"
  CHECK (
    "status" != 'pending_approval'
    OR ("submitted_by" IS NOT NULL AND "submitted_at" IS NOT NULL
        AND "us_residency_attested_by" IS NOT NULL AND "us_residency_attested_at" IS NOT NULL)
  );--> statement-breakpoint
-- N5: a revoked connection always records who revoked it and when.
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_revoked_requires_fields"
  CHECK ("status" != 'revoked' OR ("revoked_by" IS NOT NULL AND "revoked_at" IS NOT NULL));--> statement-breakpoint

ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_trigger_valid"
  CHECK ("trigger" IN ('manual', 'scheduled'));--> statement-breakpoint
-- A CHECK can't hold a subquery directly; this wraps the per-element regex test in a function
-- (immutable, so Postgres may cache it) that a CHECK can call.
CREATE FUNCTION integration_codes_well_formed(codes text[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE AS $$
  SELECT NOT EXISTS (SELECT 1 FROM unnest(codes) AS x WHERE x !~ '^[a-z_]{1,64}$')
$$;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_issue_codes_format"
  CHECK (integration_codes_well_formed("issue_codes"));--> statement-breakpoint

ALTER TABLE "integration_sync_issues" ADD CONSTRAINT "integration_sync_issues_code_format"
  CHECK ("code" ~ '^[a-z_]{1,64}$');--> statement-breakpoint

-- Patient provenance (docs/specs/patient-integrations.md "Field mapping"; ADR 0010): a manual row
-- always keeps its member ID; a synced row's external id, connection, and member ID line up with
-- its source and coverage.
ALTER TABLE "patients" ADD CONSTRAINT "patients_source_status_valid"
  CHECK ("source_status" IS NULL OR "source_status" IN ('inactive', 'merged', 'gone'));--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_coverage_status_valid"
  CHECK ("coverage_status" IN ('none', 'mapped', 'unmapped', 'needs_review'));--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_source_connection_presence"
  CHECK (("source" = 'fhir') = ("source_connection_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_external_id_presence"
  CHECK (("source" = 'fhir') = ("external_id" IS NOT NULL));--> statement-breakpoint
-- FHIR id syntax (https://hl7.org/fhir/R4/datatypes.html#id): letters, digits, '-', '.', 1-64 chars.
ALTER TABLE "patients" ADD CONSTRAINT "patients_external_id_format"
  CHECK ("external_id" IS NULL OR "external_id" ~ '^[A-Za-z0-9\-\.]{1,64}$');--> statement-breakpoint
-- Fixed vocabulary (spec "Field mapping" I4; ⚠️ VERIFY): v3-Confidentiality R/V, five ActCode
-- sensitivity codes, or "unknown" for any other recognized-as-unrecognized label.
ALTER TABLE "patients" ADD CONSTRAINT "patients_source_sensitivity_valid"
  CHECK ("source_sensitivity" <@ ARRAY['R', 'V', 'HIV', 'PSY', 'ETH', 'SDV', '42CFRPart2', 'unknown']::text[]);--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_member_id_presence"
  CHECK (
    ("source" = 'manual' AND "member_id_enc" IS NOT NULL AND "member_id_last4" IS NOT NULL)
    OR (
      "source" = 'fhir'
      AND ("member_id_enc" IS NOT NULL) = ("coverage_status" IN ('mapped', 'unmapped'))
      AND ("member_id_last4" IS NOT NULL) = ("coverage_status" IN ('mapped', 'unmapped'))
    )
  );--> statement-breakpoint
-- Security review L2: a manual row (never touched by a sync run) keeps every sync-owned column at
-- its default; only a linked/synced row uses them.
ALTER TABLE "patients" ADD CONSTRAINT "patients_manual_defaults"
  CHECK (
    "source" = 'fhir'
    OR (
      "source_version_id" IS NULL
      AND "source_last_updated" IS NULL
      AND "synced_at" IS NULL
      AND "source_status" IS NULL
      AND "source_restricted" = false
      AND "source_sensitivity" = '{}'::text[]
      AND "coverage_status" = 'none'
      AND "coverage_payor_key" IS NULL
    )
  );--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5), same pattern as drizzle/0023. No DELETE grant: a
-- connection is revoked, never removed (R-9.2.1); approval fields are never granted to the app
-- role (E2 below) — the operator writes them via withTenantAsPlatform (table-owner privileges).
ALTER TABLE "integration_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_connections"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT ON "integration_connections" TO denialdesk_app;--> statement-breakpoint
GRANT INSERT (
  "tenant_id", "target_table", "kind", "is_sandbox", "display_name", "base_url", "endpoint_key",
  "client_id", "mrn_identifier_system", "created_by", "updated_by"
) ON "integration_connections" TO denialdesk_app;--> statement-breakpoint
GRANT UPDATE (
  "display_name", "base_url", "endpoint_key", "token_endpoint", "token_endpoint_key", "issuer",
  "client_id", "mrn_identifier_system",
  "us_residency_attested_by", "us_residency_attested_at",
  "status", "status_reason", "submitted_by", "submitted_at", "revoked_by", "revoked_at",
  "has_synced", "patient_watermark", "coverage_watermark", "last_success_at", "bulk_group_id",
  "updated_by", "updated_at"
) ON "integration_connections" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "integration_sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_sync_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_sync_runs"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT ON "integration_sync_runs" TO denialdesk_app;--> statement-breakpoint
GRANT INSERT ("tenant_id", "connection_id", "trigger", "triggered_by") ON "integration_sync_runs" TO denialdesk_app;--> statement-breakpoint
GRANT UPDATE (
  "status", "started_at", "finished_at", "heartbeat_at", "patient_watermark", "coverage_watermark",
  "created_count", "updated_count", "linked_count", "skipped_count", "issue_codes", "http_status"
) ON "integration_sync_runs" TO denialdesk_app;--> statement-breakpoint

-- Append-only (R-9.2.1), same pattern as custom_field_value_versions: SELECT/INSERT only, plus a
-- trigger below refuses UPDATE/DELETE/TRUNCATE defense in depth.
ALTER TABLE "integration_sync_issues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_sync_issues" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_sync_issues"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "integration_sync_issues" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "integration_payer_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_payer_mappings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "integration_payer_mappings"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "integration_payer_mappings" TO denialdesk_app;--> statement-breakpoint

CREATE FUNCTION integration_sync_issues_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'integration_sync_issues is append-only';
END
$$;--> statement-breakpoint
CREATE TRIGGER integration_sync_issues_no_update BEFORE UPDATE OR DELETE ON "integration_sync_issues"
  FOR EACH ROW EXECUTE FUNCTION integration_sync_issues_immutable();--> statement-breakpoint
CREATE TRIGGER integration_sync_issues_no_truncate BEFORE TRUNCATE ON "integration_sync_issues"
  FOR EACH STATEMENT EXECUTE FUNCTION integration_sync_issues_immutable();--> statement-breakpoint

-- Security review compliance-7: same append-only defense in depth as sync issues (no DELETE grant
-- either). Disabled/re-enabled by purge_demo_practices() for a demo-tenant purge.
CREATE FUNCTION integration_sync_runs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'integration_sync_runs cannot be deleted';
END
$$;--> statement-breakpoint
CREATE TRIGGER integration_sync_runs_no_delete BEFORE DELETE ON "integration_sync_runs"
  FOR EACH ROW EXECUTE FUNCTION integration_sync_runs_immutable();--> statement-breakpoint
CREATE TRIGGER integration_sync_runs_no_truncate BEFORE TRUNCATE ON "integration_sync_runs"
  FOR EACH STATEMENT EXECUTE FUNCTION integration_sync_runs_immutable();--> statement-breakpoint

-- integration_sync_runs is frozen once it reaches an end state (Data / API changes), constrained
-- to the transitions the sync engine can make (security review M4/N1), and a run can only start
-- ("running") against a connection that is currently active (confused-deputy/abandoned-connection
-- defense: PI2b's job claim already requires this too, but a stale run should never slip through).
CREATE FUNCTION integration_sync_runs_lifecycle() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  connection_status text;
  -- Named apart from OLD.status/NEW.status (this migration's other trigger uses those names for a
  -- different enum; src/db/errors.ts tells them apart by expression name, not by trigger).
  old_run_status integration_sync_run_status := OLD.status;
  new_run_status integration_sync_run_status := NEW.status;
BEGIN
  IF OLD.status NOT IN ('queued', 'running') THEN
    RAISE EXCEPTION 'integration_sync_runs %: a finished run cannot change', OLD.id;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'queued' AND NEW.status IN ('running', 'abandoned'))
      OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed', 'abandoned'))
    ) THEN
      RAISE EXCEPTION 'integration_sync_runs_lifecycle: % -> % is not allowed', old_run_status, new_run_status;
    END IF;

    IF NEW.status = 'running' THEN
      SELECT status INTO connection_status FROM public.integration_connections WHERE id = NEW.connection_id;
      IF connection_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'integration_sync_runs %: the connection must be active to run', OLD.id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER integration_sync_runs_lifecycle BEFORE UPDATE ON "integration_sync_runs"
  FOR EACH ROW EXECUTE FUNCTION integration_sync_runs_lifecycle();--> statement-breakpoint

-- Global endpoint registry (threat model S2, M-a, M-b): no RLS, no grant to denialdesk_app. Reached
-- only through these two SECURITY DEFINER functions, each tenant-checked against the connection
-- named, with a fixed search_path (pg_temp last, security review M1) so a planted temp table or a
-- session-local search_path can't redirect their lookups, and never runnable by PUBLIC (M2).
CREATE FUNCTION integration_registry_claim(p_connection_id uuid) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  conn RECORD;
BEGIN
  -- FOR UPDATE (security review M3): serializes concurrent claim attempts on the same connection.
  SELECT id, tenant_id, is_sandbox, endpoint_key, client_id, status, token_endpoint_key
    INTO conn FROM public.integration_connections WHERE id = p_connection_id FOR UPDATE;
  IF conn.id IS NULL THEN RETURN false; END IF;
  IF conn.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN
    RETURN false;
  END IF;
  -- The synthetic sandbox is never a real endpoint and is never registered.
  IF conn.is_sandbox THEN RETURN true; END IF;
  -- M3: only the Submit step (draft -> pending_approval) claims; never draft, active, or beyond.
  IF conn.status IS DISTINCT FROM 'pending_approval' THEN RETURN false; END IF;
  -- H3: discovery (PI2a) must have already pinned the real token endpoint before Submit claims it.
  IF conn.token_endpoint_key IS NULL THEN RETURN false; END IF;
  BEGIN
    INSERT INTO public.integration_endpoint_registry (connection_id, endpoint_key, client_id, token_endpoint_key)
    VALUES (conn.id, conn.endpoint_key, conn.client_id, conn.token_endpoint_key)
    ON CONFLICT (connection_id) DO UPDATE
      SET endpoint_key = excluded.endpoint_key, client_id = excluded.client_id,
          token_endpoint_key = excluded.token_endpoint_key;
  EXCEPTION WHEN unique_violation THEN
    RETURN false;
  END;
  RETURN true;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION integration_registry_claim(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION integration_registry_claim(uuid) TO denialdesk_app;--> statement-breakpoint

CREATE FUNCTION integration_registry_release(p_connection_id uuid) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public, pg_temp
  AS $$
DECLARE
  conn RECORD;
  removed integer;
BEGIN
  SELECT id, tenant_id, status INTO conn FROM public.integration_connections WHERE id = p_connection_id FOR UPDATE;
  IF conn.id IS NULL THEN RETURN false; END IF;
  IF conn.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN
    RETURN false;
  END IF;
  -- Enforced here, in the database, not trusted from the caller: release only follows a transition
  -- to draft (withdraw/reject) or revoked (spec "Connection lifecycle").
  IF conn.status NOT IN ('draft', 'revoked') THEN
    RAISE EXCEPTION 'integration_registry_release: connection % is not draft or revoked', p_connection_id;
  END IF;
  DELETE FROM public.integration_endpoint_registry WHERE connection_id = p_connection_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION integration_registry_release(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION integration_registry_release(uuid) TO denialdesk_app;--> statement-breakpoint

-- Read-only synced patients (docs/specs/patient-integrations.md "Connection lifecycle" and
-- "PI1a"; ADR 0010; threat model T2). A `fhir` row (insert or a change to a synced column) is
-- refused unless app.sync_run_id names a `running` run of app.sync_connection_id, that run's own
-- connection is `active` (security review M4), the run belongs to the row's own tenant, and that
-- run's connection is the row's own source_connection_id. `fhir -> manual` is always refused, even
-- during a run. Sensitivity tags (compliance review #2) and every other patient-owned column (and
-- custom field values, a separate table) stay editable regardless — except while a sync run's
-- settings are active at all, when even sensitivity tags are frozen (a sync should never touch
-- them, so any attempt, even from other code running inside that same run's context, is a bug).
CREATE FUNCTION patients_synced_readonly() RETURNS trigger
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
CREATE TRIGGER patients_synced_readonly BEFORE INSERT OR UPDATE ON "patients"
  FOR EACH ROW EXECUTE FUNCTION patients_synced_readonly();--> statement-breakpoint

-- Connection lifecycle and editability (spec "Connection lifecycle"; threat model E2). The app
-- role cannot write approval columns (column grants above) and, even if it could, this trigger
-- still refuses the one transition that must be the operator's: pending_approval -> active.
CREATE FUNCTION integration_connections_lifecycle() RETURNS trigger
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
CREATE TRIGGER integration_connections_lifecycle BEFORE UPDATE ON "integration_connections"
  FOR EACH ROW EXECUTE FUNCTION integration_connections_lifecycle();--> statement-breakpoint

-- Security review M4: revoking a connection abandons whatever it was mid-sync (a queued or
-- running run has no connection left to run against).
CREATE FUNCTION integration_connections_abandon_runs() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp
  AS $$
BEGIN
  IF NEW.status = 'revoked' AND OLD.status IS DISTINCT FROM 'revoked' THEN
    UPDATE public.integration_sync_runs
      SET status = 'abandoned', finished_at = now()
      WHERE connection_id = NEW.id AND status IN ('queued', 'running');
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER integration_connections_abandon_runs AFTER UPDATE ON "integration_connections"
  FOR EACH ROW EXECUTE FUNCTION integration_connections_abandon_runs();--> statement-breakpoint

-- Correctness review B1: purge_demo_practices() (0032/0034/0038) predates the integration tables;
-- their foreign keys to tenants/patients/payers would make a demo-tenant purge fail otherwise.
-- Same function, extended with the new tables in FK order (issues -> runs -> mappings -> patients
-- (existing) -> this tenant's registry rows -> connections), all before payers/users/tenants.
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
  DROP TABLE purge_users;
  RETURN purged;
END
$$;