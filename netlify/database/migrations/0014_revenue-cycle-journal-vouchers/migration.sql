-- Generated from drizzle/0014_revenue_cycle_journal_vouchers.sql by `pnpm netlify:migrations`. Do not edit.
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
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_vouchers_void_reason" CHECK ("status" <> 'void' OR ("voided_by" IS NOT NULL AND "void_reason" IS NOT NULL AND length(trim("void_reason")) BETWEEN 10 AND 500));--> statement-breakpoint
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
--> statement-breakpoint

-- Foreign keys skip row-level security, so references carry the tenant: a voucher can only point
-- at its own practice's file, and a line only at its own practice's voucher.
CREATE UNIQUE INDEX "rcm_files_tenant_id_key" ON "rcm_files" ("tenant_id", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_vouchers_tenant_id_key" ON "rcm_journal_vouchers" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_vouchers_tenant_file_fk" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "rcm_files" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "rcm_journal_lines" ADD CONSTRAINT "rcm_lines_tenant_voucher_fk" FOREIGN KEY ("tenant_id", "voucher_id") REFERENCES "rcm_journal_vouchers" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_vouchers_approval_recorded" CHECK ("status" NOT IN ('approved', 'exported') OR ("approved_by" IS NOT NULL AND "approved_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_vouchers_export_recorded" CHECK ("status" <> 'exported' OR ("exported_by" IS NOT NULL AND "exported_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "rcm_journal_vouchers" ADD CONSTRAINT "rcm_vouchers_void_recorded" CHECK ("status" <> 'void' OR "voided_at" IS NOT NULL);--> statement-breakpoint

-- Workflow moves forward only (draft -> approved -> exported; draft -> superseded; approved or
-- exported -> void), and who/when columns are written once. Actors must belong to the practice.
CREATE FUNCTION rcm_voucher_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status <> OLD.status AND NOT (
    (OLD.status = 'draft' AND NEW.status IN ('approved', 'superseded'))
    OR (OLD.status = 'approved' AND NEW.status IN ('exported', 'void'))
    OR (OLD.status = 'exported' AND NEW.status = 'void')
  ) THEN
    RAISE EXCEPTION 'rcm_voucher_workflow: % -> % is not allowed', OLD.status, NEW.status;
  END IF;
  IF (OLD.approved_by IS NOT NULL AND NEW.approved_by IS DISTINCT FROM OLD.approved_by)
    OR (OLD.approved_at IS NOT NULL AND NEW.approved_at IS DISTINCT FROM OLD.approved_at)
    OR (OLD.exported_by IS NOT NULL AND NEW.exported_by IS DISTINCT FROM OLD.exported_by)
    OR (OLD.exported_at IS NOT NULL AND NEW.exported_at IS DISTINCT FROM OLD.exported_at)
    OR (OLD.voided_by IS NOT NULL AND NEW.voided_by IS DISTINCT FROM OLD.voided_by)
    OR (OLD.voided_at IS NOT NULL AND NEW.voided_at IS DISTINCT FROM OLD.voided_at)
    OR (OLD.void_reason IS NOT NULL AND NEW.void_reason IS DISTINCT FROM OLD.void_reason) THEN
    RAISE EXCEPTION 'rcm_voucher_workflow: approval, export, and void records are write-once';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[NEW.approved_by, NEW.exported_by, NEW.voided_by]) AS actor(id)
    WHERE actor.id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = actor.id AND m.tenant_id = NEW.tenant_id)
  ) THEN
    RAISE EXCEPTION 'rcm_voucher_workflow: actor is not a member of this practice';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER rcm_voucher_workflow BEFORE UPDATE ON "rcm_journal_vouchers"
  FOR EACH ROW EXECUTE FUNCTION rcm_voucher_workflow();
--> statement-breakpoint

-- Lines are written only while their voucher is a draft (prepareVoucher inserts them right after
-- the voucher); an approved or exported voucher can't gain lines.
CREATE FUNCTION rcm_journal_lines_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM rcm_journal_vouchers v WHERE v.id = NEW.voucher_id AND v.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'rcm_journal_lines_draft_only: lines can only be added to a draft voucher';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER rcm_journal_lines_draft_only BEFORE INSERT ON "rcm_journal_lines"
  FOR EACH ROW EXECUTE FUNCTION rcm_journal_lines_draft_only();--> statement-breakpoint

-- Practices set up before this migration: flag the starter chart's payments-clearing account.
-- Tenant by tenant, because FORCE row-level security hides rows from a non-superuser owner.
DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    UPDATE gl_accounts SET is_payments_clearing = true
      WHERE tenant_id = t AND number = '1050' AND kind = 'cash'
        AND NOT EXISTS (SELECT 1 FROM gl_accounts g WHERE g.tenant_id = t AND g.is_payments_clearing);
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
