CREATE TYPE "public"."rcm_voucher_line_role" AS ENUM('charges', 'adjustments', 'payments', 'reclass');--> statement-breakpoint
CREATE TYPE "public"."rcm_voucher_status" AS ENUM('draft', 'approved', 'exported', 'superseded', 'void');--> statement-breakpoint
CREATE TABLE "rcm_journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"voucher_id" uuid NOT NULL,
	"line_number" integer NOT NULL,
	"role" "rcm_voucher_line_role" NOT NULL,
	"account" text NOT NULL,
	"site_code" text NOT NULL,
	"debit_cents" bigint NOT NULL,
	"credit_cents" bigint NOT NULL,
	"memo" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rcm_journal_vouchers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"period_year" integer NOT NULL,
	"period_month" integer NOT NULL,
	"version" integer NOT NULL,
	"number" text NOT NULL,
	"status" "rcm_voucher_status" DEFAULT 'draft' NOT NULL,
	"debit_cents" bigint NOT NULL,
	"credit_cents" bigint NOT NULL,
	"prepared_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"exported_by" uuid,
	"exported_at" timestamp with time zone,
	"voided_by" uuid,
	"voided_at" timestamp with time zone,
	"void_reason" text
);
--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD COLUMN "is_payments_clearing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "rcm_journal_lines" ADD CONSTRAINT "rcm_journal_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_journal_lines" ADD CONSTRAINT "rcm_journal_lines_voucher_id_rcm_journal_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."rcm_journal_vouchers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_journal_vouchers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_journal_vouchers_file_id_rcm_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."rcm_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_journal_vouchers_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_journal_vouchers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_journal_vouchers_exported_by_users_id_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_journal_vouchers_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_journal_lines_voucher_line_key" ON "rcm_journal_lines" USING btree ("voucher_id","line_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_vouchers_period_version_key" ON "rcm_journal_vouchers" USING btree ("tenant_id","period_year","period_month","version");--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_vouchers_one_posted_per_period" ON "rcm_journal_vouchers" USING btree ("tenant_id","period_year","period_month") WHERE status in ('approved', 'exported');--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_vouchers_one_draft_per_period" ON "rcm_journal_vouchers" USING btree ("tenant_id","period_year","period_month") WHERE status = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_one_payments_clearing" ON "gl_accounts" USING btree ("tenant_id") WHERE is_payments_clearing;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_clearing_is_cash" CHECK (NOT "is_payments_clearing" OR "kind" = 'cash');--> statement-breakpoint
ALTER TABLE "rcm_journal_lines" ADD CONSTRAINT "rcm_journal_lines_one_side" CHECK ("debit_cents" >= 0 AND "credit_cents" >= 0 AND ("debit_cents" = 0) <> ("credit_cents" = 0));--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_vouchers_period_valid" CHECK ("period_month" BETWEEN 1 AND 12 AND "period_year" BETWEEN 2000 AND 2100);--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_vouchers_void_reason" CHECK ("status" <> 'void' OR ("voided_by" IS NOT NULL AND length(trim("void_reason")) >= 10));--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_vouchers_approver_not_preparer" CHECK ("approved_by" IS NULL OR "approved_by" <> "prepared_by");--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5), no DELETE (R-9.2.1). Voucher amounts and lines are
-- immutable: the app role can insert lines but never change them, and can update only the
-- workflow columns of a voucher (approval, export, void, superseded).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rcm_journal_vouchers', 'rcm_journal_lines']
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
$$;--> statement-breakpoint
GRANT UPDATE ("status", "approved_by", "approved_at", "exported_by", "exported_at", "voided_by", "voided_at", "void_reason") ON "rcm_journal_vouchers" TO denialdesk_app;
