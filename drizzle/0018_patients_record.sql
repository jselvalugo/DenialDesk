ALTER TABLE "patients" ADD COLUMN "sex" text DEFAULT 'U' NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "primary_payer_id" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "payers_tenant_id_key" ON "payers" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_primary_payer_fk" FOREIGN KEY ("tenant_id","primary_payer_id") REFERENCES "public"."payers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "claims_tenant_patient_idx" ON "claims" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "patients_tenant_name_idx" ON "patients" USING btree ("tenant_id","last_name","first_name");--> statement-breakpoint

-- Patient record shape (docs/specs/patients.md). Values are checked here as well as in the app.
ALTER TABLE "patients" ADD CONSTRAINT "patients_sex_valid" CHECK ("sex" IN ('F', 'M', 'U'));--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_state_valid" CHECK ("state" IS NULL OR "state" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_postal_code_valid" CHECK ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{5}(-[0-9]{4})?$');--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_mrn_present" CHECK (length(btrim("mrn")) BETWEEN 1 AND 40);--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_names_present" CHECK (length(btrim("first_name")) BETWEEN 1 AND 60 AND length(btrim("last_name")) BETWEEN 1 AND 60);--> statement-breakpoint

-- Primary coverage for existing patients: the payer of their most recent claim. patients forces
-- row-level security, so the backfill runs tenant by tenant with app.tenant_id set; a non-superuser
-- migration role (Netlify, Azure) would otherwise see no rows.
DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    UPDATE patients p
    SET primary_payer_id = (
      SELECT c.payer_id FROM claims c
      WHERE c.tenant_id = t AND c.patient_id = p.id
      ORDER BY c.service_date DESC, c.id
      LIMIT 1
    )
    WHERE p.tenant_id = t AND p.primary_payer_id IS NULL;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
