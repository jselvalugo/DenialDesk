-- Generated from drizzle/0011_claim_versions.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TABLE "claim_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"changed_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"reason" text NOT NULL,
	"changed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claims" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "claim_versions" ADD CONSTRAINT "claim_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_versions" ADD CONSTRAINT "claim_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claims_tenant_id_key" ON "claims" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "claim_versions" ADD CONSTRAINT "claim_versions_claim_fk" FOREIGN KEY ("tenant_id","claim_id") REFERENCES "public"."claims"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_versions_claim_version_key" ON "claim_versions" USING btree ("tenant_id","claim_id","version");--> statement-breakpoint
--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5). Claim history is append-only (R-3.10.3).
ALTER TABLE "claim_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claim_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "claim_versions" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "claim_versions" TO denialdesk_app;--> statement-breakpoint
ALTER TABLE "claim_versions" ADD CONSTRAINT "claim_versions_version_positive" CHECK ("version" >= 1);--> statement-breakpoint
ALTER TABLE "claim_versions" ADD CONSTRAINT "claim_versions_reason_present" CHECK (length(btrim("reason")) > 0);--> statement-breakpoint

CREATE OR REPLACE FUNCTION claim_versions_immutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  RAISE EXCEPTION 'claim_versions is append-only';
END
$$;--> statement-breakpoint
CREATE TRIGGER claim_versions_no_update BEFORE UPDATE OR DELETE ON "claim_versions"
  FOR EACH ROW EXECUTE FUNCTION claim_versions_immutable();--> statement-breakpoint
-- "When" is the database's clock and "who" is the signed-in user bound to the transaction (or
-- NULL for system-created versions), never a value the caller chose.
CREATE OR REPLACE FUNCTION claim_versions_stamp() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  NEW.created_at := now();
  IF NEW.changed_by IS NOT NULL
     AND NEW.changed_by IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')::uuid THEN
    RAISE EXCEPTION 'claim_versions.changed_by must be the current user';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER claim_versions_stamp BEFORE INSERT ON "claim_versions"
  FOR EACH ROW EXECUTE FUNCTION claim_versions_stamp();--> statement-breakpoint
CREATE TRIGGER claim_versions_no_truncate BEFORE TRUNCATE ON "claim_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION claim_versions_immutable();--> statement-breakpoint

-- A change to a claim's billed content must come with its new version row, written first in the
-- same transaction. now() is the transaction start time, so it identifies rows from this transaction.
CREATE OR REPLACE FUNCTION claims_require_version() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  -- created_at identifies claims created in this transaction (see claim_lines_require_version).
  IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'claims.created_at cannot change';
  END IF;
  IF NEW.service_date IS NOT DISTINCT FROM OLD.service_date
     AND NEW.patient_id IS NOT DISTINCT FROM OLD.patient_id
     AND NEW.payer_id IS NOT DISTINCT FROM OLD.payer_id
     AND NEW.provider_id IS NOT DISTINCT FROM OLD.provider_id
     AND NEW.location_id IS NOT DISTINCT FROM OLD.location_id
     AND NEW.diagnosis_codes IS NOT DISTINCT FROM OLD.diagnosis_codes
     AND NEW.billed_cents IS NOT DISTINCT FROM OLD.billed_cents
     AND NEW.version IS NOT DISTINCT FROM OLD.version THEN
    RETURN NEW;
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'claim % must move to version %', OLD.id, OLD.version + 1;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM claim_versions v
    WHERE v.claim_id = NEW.id AND v.version = NEW.version AND v.created_at = now()
  ) THEN
    RAISE EXCEPTION 'claim % version % has no history row', NEW.id, NEW.version;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER claims_require_version BEFORE UPDATE ON "claims"
  FOR EACH ROW EXECUTE FUNCTION claims_require_version();--> statement-breakpoint

-- Lines of an existing claim change only alongside a version row from this transaction. Lines of a
-- claim created in this transaction (seed, import) need none yet.
CREATE OR REPLACE FUNCTION claim_lines_require_version() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.claim_id IS NOT DISTINCT FROM OLD.claim_id
     AND NEW.line_number IS NOT DISTINCT FROM OLD.line_number
     AND NEW.procedure_code IS NOT DISTINCT FROM OLD.procedure_code
     AND NEW.modifiers IS NOT DISTINCT FROM OLD.modifiers
     AND NEW.units IS NOT DISTINCT FROM OLD.units
     AND NEW.charge_cents IS NOT DISTINCT FROM OLD.charge_cents THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM claims c WHERE c.id = NEW.claim_id AND c.created_at = now()) THEN
    RETURN NEW;
  END IF;
  -- The claim must already be at a version written in this transaction (claims updated first).
  IF NOT EXISTS (
    SELECT 1 FROM claims c
    JOIN claim_versions v ON v.claim_id = c.id AND v.version = c.version
    WHERE c.id = NEW.claim_id AND v.created_at = now()
  ) THEN
    RAISE EXCEPTION 'lines of claim % changed without a new claim version', NEW.claim_id;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER claim_lines_require_version BEFORE INSERT OR UPDATE ON "claim_lines"
  FOR EACH ROW EXECUTE FUNCTION claim_lines_require_version();--> statement-breakpoint

-- Version 1 for every existing claim, as it stands today (system-recorded). claims and claim_versions
-- force row-level security, so the backfill runs tenant by tenant with app.tenant_id set; a
-- non-superuser migration role (Netlify, Azure) would otherwise see no claims and insert nothing.
DO $$
DECLARE
  t uuid;
  missing bigint;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    INSERT INTO claim_versions (tenant_id, claim_id, version, snapshot, reason)
    SELECT c.tenant_id, c.id, 1,
      jsonb_build_object(
        'serviceDate', c.service_date,
        'diagnosisCodes', to_jsonb(c.diagnosis_codes),
        'billedCents', c.billed_cents,
        'status', c.status,
        'lines', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'lineNumber', l.line_number, 'procedureCode', l.procedure_code, 'modifiers', to_jsonb(l.modifiers),
            'units', l.units, 'chargeCents', l.charge_cents) ORDER BY l.line_number)
          FROM claim_lines l WHERE l.claim_id = c.id), '[]'::jsonb)
      ),
      'Existing claim recorded when version history started'
    FROM claims c
    WHERE c.tenant_id = t;
    SELECT count(*) INTO missing FROM claims c
      WHERE c.tenant_id = t AND NOT EXISTS (SELECT 1 FROM claim_versions v WHERE v.claim_id = c.id);
    IF missing > 0 THEN
      RAISE EXCEPTION 'claim version backfill missed % claims', missing;
    END IF;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
