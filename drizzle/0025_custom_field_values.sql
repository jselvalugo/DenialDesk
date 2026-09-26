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

  IF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.field_id IS DISTINCT FROM OLD.field_id
       OR NEW.patient_id IS DISTINCT FROM OLD.patient_id OR NEW.claim_id IS DISTINCT FROM OLD.claim_id
       OR NEW.denial_id IS DISTINCT FROM OLD.denial_id OR NEW.payer_id IS DISTINCT FROM OLD.payer_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'custom_field_values identity is immutable';
    END IF;
  END IF;

  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER custom_field_values_guard BEFORE INSERT OR UPDATE ON "custom_field_values"
  FOR EACH ROW EXECUTE FUNCTION custom_field_values_guard();