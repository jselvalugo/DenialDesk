-- Generated from drizzle/0015_revenue_cycle_deposits.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TABLE "rcm_deposit_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"row_count" integer NOT NULL,
	"total_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rcm_deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"deposit_date" date NOT NULL,
	"amount_cents" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rcm_deposit_files" ADD CONSTRAINT "rcm_deposit_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_deposit_files" ADD CONSTRAINT "rcm_deposit_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_deposits" ADD CONSTRAINT "rcm_deposits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_deposits" ADD CONSTRAINT "rcm_deposits_file_id_rcm_deposit_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."rcm_deposit_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_deposits_file_row_key" ON "rcm_deposits" USING btree ("file_id","row_number");--> statement-breakpoint
CREATE INDEX "rcm_deposits_tenant_date_idx" ON "rcm_deposits" USING btree ("tenant_id","deposit_date");--> statement-breakpoint
ALTER TABLE "rcm_deposits" ADD CONSTRAINT "rcm_deposits_nonzero" CHECK ("amount_cents" <> 0);--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5). Deposits are records: insert and read only, no
-- UPDATE or DELETE (R-9.2.1); a wrong deposit is corrected by a reversing entry.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rcm_deposit_files', 'rcm_deposits']
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
--> statement-breakpoint
-- A draft voucher carries no approval, export, or void stamp (write-once stamps would otherwise
-- block its real approval).
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_vouchers_draft_unstamped" CHECK ("status" <> 'draft' OR ("approved_by" IS NULL AND "exported_by" IS NULL AND "voided_by" IS NULL));
