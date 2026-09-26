-- Generated from drizzle/0027_custom_field_values.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TABLE "custom_field_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"patient_id" uuid,
	"claim_id" uuid,
	"denial_id" uuid,
	"payer_id" uuid,
	"value_enc" text,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_field_id_custom_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_denial_id_denials_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_payer_id_payers_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_tenant_field_patient_key" ON "custom_field_values" USING btree ("tenant_id","field_id","patient_id") WHERE "custom_field_values"."patient_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_tenant_field_claim_key" ON "custom_field_values" USING btree ("tenant_id","field_id","claim_id") WHERE "custom_field_values"."claim_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_tenant_field_denial_key" ON "custom_field_values" USING btree ("tenant_id","field_id","denial_id") WHERE "custom_field_values"."denial_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_tenant_field_payer_key" ON "custom_field_values" USING btree ("tenant_id","field_id","payer_id") WHERE "custom_field_values"."payer_id" is not null;--> statement-breakpoint
CREATE INDEX "custom_field_values_tenant_patient_idx" ON "custom_field_values" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_tenant_claim_idx" ON "custom_field_values" USING btree ("tenant_id","claim_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_tenant_denial_idx" ON "custom_field_values" USING btree ("tenant_id","denial_id");--> statement-breakpoint
CREATE INDEX "custom_field_values_tenant_payer_idx" ON "custom_field_values" USING btree ("tenant_id","payer_id");--> statement-breakpoint

-- Exactly one record column is set (docs/decisions/0007-custom-field-value-storage.md): real FKs,
-- not a polymorphic ID. Ciphertext is capped (ADR 0007 / threat model T3); NULL clears a value.
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_one_record"
  CHECK (num_nonnulls("patient_id", "claim_id", "denial_id", "payer_id") = 1);--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_value_size"
  CHECK ("value_enc" IS NULL OR length("value_enc") <= 8192);--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5), same pattern as drizzle/0023. No DELETE grant
-- (R-9.2.1): a cleared value sets value_enc to NULL, it is never removed.
ALTER TABLE "custom_field_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_values" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "custom_field_values"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "custom_field_values" TO denialdesk_app;--> statement-breakpoint

-- Foreign keys alone don't stop a value pointing at a field or record from another tenant, or at a
-- record of the wrong entity for the field (FKs bypass RLS; threat model T1). This trigger checks
-- both, and keeps tenant_id / field_id / the record columns / created_* fixed once written.
CREATE FUNCTION custom_field_values_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  field_tenant_id uuid;
  field_entity text;
  record_tenant_id uuid;
BEGIN
  -- Checked first, before any lookup: a change to an identity column is refused outright, even
  -- one that also happens to point at a bogus or cross-tenant id (which would otherwise surface as
  -- a confusing "does not belong to this tenant" instead of the real problem).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.field_id IS DISTINCT FROM OLD.field_id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.claim_id IS DISTINCT FROM OLD.claim_id
       OR NEW.denial_id IS DISTINCT FROM OLD.denial_id OR NEW.payer_id IS DISTINCT FROM OLD.payer_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'custom_field_values identity is immutable';
    END IF;
  END IF;

  SELECT tenant_id, entity INTO field_tenant_id, field_entity
    FROM custom_fields WHERE id = NEW.field_id;
  IF field_tenant_id IS NULL OR field_tenant_id != NEW.tenant_id THEN
    RAISE EXCEPTION 'custom_field_values: field does not belong to this tenant';
  END IF;

  IF NEW.patient_id IS NOT NULL THEN
    IF field_entity != 'patient' THEN
      RAISE EXCEPTION 'custom_field_values: field is not a patient field';
    END IF;
    SELECT tenant_id INTO record_tenant_id FROM patients WHERE id = NEW.patient_id;
  ELSIF NEW.claim_id IS NOT NULL THEN
    IF field_entity != 'claim' THEN
      RAISE EXCEPTION 'custom_field_values: field is not a claim field';
    END IF;
    SELECT tenant_id INTO record_tenant_id FROM claims WHERE id = NEW.claim_id;
  ELSIF NEW.denial_id IS NOT NULL THEN
    IF field_entity != 'denial' THEN
      RAISE EXCEPTION 'custom_field_values: field is not a denial field';
    END IF;
    SELECT tenant_id INTO record_tenant_id FROM denials WHERE id = NEW.denial_id;
  ELSIF NEW.payer_id IS NOT NULL THEN
    -- Payers are per-tenant (spec: owner decision 2026-09-26; payers.tenant_id exists).
    IF field_entity != 'payer' THEN
      RAISE EXCEPTION 'custom_field_values: field is not a payer field';
    END IF;
    SELECT tenant_id INTO record_tenant_id FROM payers WHERE id = NEW.payer_id;
  END IF;

  IF record_tenant_id IS NULL OR record_tenant_id != NEW.tenant_id THEN
    RAISE EXCEPTION 'custom_field_values: record does not belong to this tenant';
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER custom_field_values_guard BEFORE INSERT OR UPDATE ON "custom_field_values"
  FOR EACH ROW EXECUTE FUNCTION custom_field_values_guard();--> statement-breakpoint
CREATE TABLE "custom_field_value_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"value_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"patient_id" uuid,
	"claim_id" uuid,
	"denial_id" uuid,
	"payer_id" uuid,
	"value_enc" text,
	"changed_by" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_value_id_custom_field_values_id_fk" FOREIGN KEY ("value_id") REFERENCES "public"."custom_field_values"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_field_id_custom_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_fields"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_denial_id_denials_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_payer_id_payers_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_values_tenant_id_key" ON "custom_field_values" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_value_fk" FOREIGN KEY ("tenant_id","value_id") REFERENCES "public"."custom_field_values"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_field_value_versions_value_idx" ON "custom_field_value_versions" USING btree ("value_id","changed_at");--> statement-breakpoint

-- Same one-record-column shape as the parent table (docs/decisions/0007-custom-field-value-storage.md
-- addendum 2026-09-26): a version row is a snapshot of one custom_field_values row.
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_one_record"
  CHECK (num_nonnulls("patient_id", "claim_id", "denial_id", "payer_id") = 1);--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" ADD CONSTRAINT "custom_field_value_versions_value_size"
  CHECK ("value_enc" IS NULL OR length("value_enc") <= 8192);--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5). Append-only history: SELECT and INSERT only, no
-- UPDATE or DELETE grant, and a trigger refuses both defense-in-depth (same pattern as
-- audit_events, drizzle/0002_security.sql).
ALTER TABLE "custom_field_value_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_field_value_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "custom_field_value_versions"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "custom_field_value_versions" TO denialdesk_app;--> statement-breakpoint

-- A version row is a snapshot of one custom_field_values row: its field_id and record column must
-- match that row's, not just any field/record in the tenant (the one-record-column CHECK above and
-- the tenant FK don't catch a version pointing at the right value_id but the wrong field or record).
CREATE FUNCTION custom_field_value_versions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_field_id uuid;
  parent_patient_id uuid;
  parent_claim_id uuid;
  parent_denial_id uuid;
  parent_payer_id uuid;
BEGIN
  SELECT field_id, patient_id, claim_id, denial_id, payer_id
    INTO parent_field_id, parent_patient_id, parent_claim_id, parent_denial_id, parent_payer_id
    FROM custom_field_values WHERE id = NEW.value_id;
  IF parent_field_id IS NULL THEN
    RAISE EXCEPTION 'custom_field_value_versions: value_id does not exist';
  END IF;
  IF NEW.field_id != parent_field_id THEN
    RAISE EXCEPTION 'custom_field_value_versions: field_id does not match the value row';
  END IF;
  IF NEW.patient_id IS DISTINCT FROM parent_patient_id OR NEW.claim_id IS DISTINCT FROM parent_claim_id
     OR NEW.denial_id IS DISTINCT FROM parent_denial_id OR NEW.payer_id IS DISTINCT FROM parent_payer_id THEN
    RAISE EXCEPTION 'custom_field_value_versions: record does not match the value row';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER custom_field_value_versions_guard BEFORE INSERT ON "custom_field_value_versions"
  FOR EACH ROW EXECUTE FUNCTION custom_field_value_versions_guard();--> statement-breakpoint

CREATE FUNCTION custom_field_value_versions_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'custom_field_value_versions is append-only';
END
$$;--> statement-breakpoint
CREATE TRIGGER custom_field_value_versions_no_update BEFORE UPDATE OR DELETE ON "custom_field_value_versions"
  FOR EACH ROW EXECUTE FUNCTION custom_field_value_versions_immutable();--> statement-breakpoint
CREATE TRIGGER custom_field_value_versions_no_truncate BEFORE TRUNCATE ON "custom_field_value_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION custom_field_value_versions_immutable();
