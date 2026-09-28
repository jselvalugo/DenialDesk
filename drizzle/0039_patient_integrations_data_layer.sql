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
ALTER TABLE "integration_endpoint_registry" ADD CONSTRAINT "integration_endpoint_registry_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_attested_fields_together"
  CHECK (("us_residency_attested_at" IS NULL) = ("us_residency_attested_by" IS NULL));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_submitted_fields_together"
  CHECK (("submitted_at" IS NULL) = ("submitted_by" IS NULL));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_approved_fields_together"
  CHECK (("approved_at" IS NULL) = ("approved_by" IS NULL));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_revoked_fields_together"
  CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL));--> statement-breakpoint

ALTER TABLE "integration_sync_runs" ADD CONSTRAINT "integration_sync_runs_trigger_valid"
  CHECK ("trigger" IN ('manual', 'scheduled'));--> statement-breakpoint

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
ALTER TABLE "patients" ADD CONSTRAINT "patients_member_id_presence"
  CHECK (
    ("source" = 'manual' AND "member_id_enc" IS NOT NULL AND "member_id_last4" IS NOT NULL)
    OR (
      "source" = 'fhir'
      AND ("member_id_enc" IS NOT NULL) = ("coverage_status" IN ('mapped', 'unmapped'))
      AND ("member_id_last4" IS NOT NULL) = ("coverage_status" IN ('mapped', 'unmapped'))
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

-- integration_sync_runs is frozen once it reaches an end state (Data / API changes).
CREATE FUNCTION integration_sync_runs_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status NOT IN ('queued', 'running') THEN
    RAISE EXCEPTION 'integration_sync_runs %: a finished run cannot change', OLD.id;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER integration_sync_runs_frozen BEFORE UPDATE ON "integration_sync_runs"
  FOR EACH ROW EXECUTE FUNCTION integration_sync_runs_frozen();--> statement-breakpoint

-- Global endpoint registry (threat model S2, M-a, M-b): no RLS, no grant to denialdesk_app. Reached
-- only through these two SECURITY DEFINER functions, each tenant-checked against the connection
-- named, and with a fixed search_path so they can't be tricked by a session-local search_path.
CREATE FUNCTION integration_registry_claim(p_connection_id uuid) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  conn RECORD;
BEGIN
  SELECT id, tenant_id, is_sandbox, endpoint_key, client_id, status
    INTO conn FROM integration_connections WHERE id = p_connection_id;
  IF conn.id IS NULL THEN RETURN false; END IF;
  IF conn.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN
    RETURN false;
  END IF;
  -- The synthetic sandbox is never a real endpoint and is never registered.
  IF conn.is_sandbox THEN RETURN true; END IF;
  BEGIN
    INSERT INTO integration_endpoint_registry (connection_id, endpoint_key, client_id)
    VALUES (conn.id, conn.endpoint_key, conn.client_id)
    ON CONFLICT (connection_id) DO UPDATE
      SET endpoint_key = excluded.endpoint_key, client_id = excluded.client_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN false;
  END;
  RETURN true;
END
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION integration_registry_claim(uuid) TO denialdesk_app;--> statement-breakpoint

CREATE FUNCTION integration_registry_release(p_connection_id uuid) RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  conn RECORD;
  removed integer;
BEGIN
  SELECT id, tenant_id, status INTO conn FROM integration_connections WHERE id = p_connection_id;
  IF conn.id IS NULL THEN RETURN false; END IF;
  IF conn.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id', true), '')::uuid THEN
    RETURN false;
  END IF;
  -- Enforced here, in the database, not trusted from the caller: release only follows a transition
  -- to draft (withdraw/reject) or revoked (spec "Connection lifecycle").
  IF conn.status NOT IN ('draft', 'revoked') THEN
    RAISE EXCEPTION 'integration_registry_release: connection % is not draft or revoked', p_connection_id;
  END IF;
  DELETE FROM integration_endpoint_registry WHERE connection_id = p_connection_id;
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed > 0;
END
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION integration_registry_release(uuid) TO denialdesk_app;--> statement-breakpoint

-- Read-only synced patients (docs/specs/patient-integrations.md "Connection lifecycle" and
-- "PI1a"; ADR 0010; threat model T2). A `fhir` row (insert or a change to a synced column) is
-- refused unless app.sync_run_id names a `running` run of app.sync_connection_id in the row's own
-- tenant, and that run's connection is the row's own source_connection_id. `fhir -> manual` is
-- always refused, even during a run. Sensitivity tags and every other patient-owned column (and
-- custom field values, a separate table) stay editable regardless.
CREATE FUNCTION patients_synced_readonly() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  set_run_id uuid;
  set_connection_id uuid;
  run_status text;
  run_connection_id uuid;
  run_tenant_id uuid;
BEGIN
  set_run_id := nullif(current_setting('app.sync_run_id', true), '')::uuid;
  set_connection_id := nullif(current_setting('app.sync_connection_id', true), '')::uuid;

  IF TG_OP = 'INSERT' THEN
    IF NEW.source = 'fhir' THEN
      IF set_run_id IS NULL OR set_connection_id IS NULL
         OR NEW.source_connection_id IS DISTINCT FROM set_connection_id THEN
        RAISE EXCEPTION 'patients: a synced row can only be inserted by a running sync run';
      END IF;
      SELECT status, connection_id, tenant_id INTO run_status, run_connection_id, run_tenant_id
        FROM integration_sync_runs WHERE id = set_run_id;
      IF run_status IS DISTINCT FROM 'running' OR run_connection_id IS DISTINCT FROM set_connection_id
         OR run_tenant_id IS DISTINCT FROM NEW.tenant_id THEN
        RAISE EXCEPTION 'patients: a synced row can only be inserted by a running sync run';
      END IF;
    END IF;
    RETURN NEW;
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
    SELECT status, connection_id, tenant_id INTO run_status, run_connection_id, run_tenant_id
      FROM integration_sync_runs WHERE id = set_run_id;
    IF run_status IS DISTINCT FROM 'running' OR run_connection_id IS DISTINCT FROM set_connection_id
       OR run_tenant_id IS DISTINCT FROM NEW.tenant_id THEN
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
    SELECT status, connection_id, tenant_id INTO run_status, run_connection_id, run_tenant_id
      FROM integration_sync_runs WHERE id = set_run_id;
    IF run_status IS DISTINCT FROM 'running' OR run_connection_id IS DISTINCT FROM set_connection_id
       OR run_tenant_id IS DISTINCT FROM OLD.tenant_id THEN
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
    OR NEW.token_endpoint IS DISTINCT FROM OLD.token_endpoint
    OR NEW.issuer IS DISTINCT FROM OLD.issuer
    OR NEW.mrn_identifier_system IS DISTINCT FROM OLD.mrn_identifier_system
    OR NEW.client_id IS DISTINCT FROM OLD.client_id
  ) THEN
    RAISE EXCEPTION 'integration_connections %: endpoint fields are immutable once synced', OLD.id;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status = 'draft' AND NEW.status = 'pending_approval')
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

    IF OLD.status = 'pending_approval' AND NEW.status = 'active' AND current_user = 'denialdesk_app' THEN
      RAISE EXCEPTION 'integration_connections %: only the platform operator may activate a pending connection', OLD.id;
    END IF;
  ELSIF OLD.status = 'pending_approval' THEN
    -- Editability while awaiting approval: the display name only (spec "Connection lifecycle").
    IF NEW.base_url IS DISTINCT FROM OLD.base_url
       OR NEW.client_id IS DISTINCT FROM OLD.client_id
       OR NEW.mrn_identifier_system IS DISTINCT FROM OLD.mrn_identifier_system
       OR NEW.us_residency_attested_by IS DISTINCT FROM OLD.us_residency_attested_by
       OR NEW.us_residency_attested_at IS DISTINCT FROM OLD.us_residency_attested_at
    THEN
      RAISE EXCEPTION 'integration_connections %: only the display name can change while pending approval', OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER integration_connections_lifecycle BEFORE UPDATE ON "integration_connections"
  FOR EACH ROW EXECUTE FUNCTION integration_connections_lifecycle();