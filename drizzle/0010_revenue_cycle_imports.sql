CREATE TABLE "rcm_claim_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"patient_name" text NOT NULL,
	"account_number" text NOT NULL,
	"service_date" date NOT NULL,
	"cpt" text NOT NULL,
	"description" text NOT NULL,
	"facility" text NOT NULL,
	"payer_name" text NOT NULL,
	"payer_class" text NOT NULL,
	"status" text NOT NULL,
	"billed_cents" bigint NOT NULL,
	"payment_cents" bigint NOT NULL,
	"balance_cents" bigint NOT NULL,
	"site_id" uuid,
	"rule_code" text NOT NULL,
	"contra_bps" integer NOT NULL,
	"contra_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"ar_gl" text NOT NULL,
	"revenue_gl" text NOT NULL,
	"adjustment_gl" text NOT NULL,
	"excluded" boolean NOT NULL,
	"flagged" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rcm_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"filename" text NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"row_count" integer NOT NULL,
	"billed_cents" bigint NOT NULL,
	"payment_cents" bigint NOT NULL,
	"balance_cents" bigint NOT NULL,
	"contra_cents" bigint NOT NULL,
	"net_cents" bigint NOT NULL,
	"excluded_count" integer NOT NULL,
	"flagged_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" ADD CONSTRAINT "rcm_claim_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" ADD CONSTRAINT "rcm_claim_lines_file_id_rcm_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."rcm_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" ADD CONSTRAINT "rcm_claim_lines_site_id_rcm_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."rcm_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_files" ADD CONSTRAINT "rcm_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_files" ADD CONSTRAINT "rcm_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_claim_lines_file_row_key" ON "rcm_claim_lines" USING btree ("file_id","row_number");--> statement-breakpoint
CREATE INDEX "rcm_claim_lines_tenant_dos_idx" ON "rcm_claim_lines" USING btree ("tenant_id","service_date");--> statement-breakpoint
CREATE INDEX "rcm_files_tenant_period_idx" ON "rcm_files" USING btree ("tenant_id","period_year","period_month");--> statement-breakpoint
ALTER TABLE "rcm_files" ADD CONSTRAINT "rcm_files_period_valid" CHECK ("period_month" BETWEEN 1 AND 12 AND "period_year" BETWEEN 2000 AND 2100);--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" ADD CONSTRAINT "rcm_claim_lines_contra_bps_range" CHECK ("contra_bps" BETWEEN 0 AND 10000);--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5). Imports are immutable records: insert and read only.
-- A wrong file is superseded by importing a corrected one, never edited or deleted (R-9.2.1).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rcm_files', 'rcm_claim_lines']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT ON %I TO denialdesk_app', t);
  END LOOP;
END
$$;
