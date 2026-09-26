-- Generated from drizzle/0009_revenue_cycle_setup.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TYPE "public"."gl_account_kind" AS ENUM('cash', 'ar', 'revenue', 'adjustment');--> statement-breakpoint
CREATE TABLE "business_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"priority" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"match" jsonb NOT NULL,
	"contra_bps" integer NOT NULL,
	"excluded" boolean DEFAULT false NOT NULL,
	"ar_gl" text,
	"revenue_gl" text,
	"adjustment_gl" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gl_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"name" text NOT NULL,
	"kind" "gl_account_kind" NOT NULL,
	"revenue_gl" text,
	"adjustment_gl" text,
	"is_default_ar" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payer_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"payer_id" uuid,
	"ar_gl" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rcm_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_rules" ADD CONSTRAINT "business_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_classes" ADD CONSTRAINT "payer_classes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payer_classes" ADD CONSTRAINT "payer_classes_payer_id_payers_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_sites" ADD CONSTRAINT "rcm_sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcm_sites" ADD CONSTRAINT "rcm_sites_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "business_rules_tenant_code_key" ON "business_rules" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "business_rules_tenant_priority_key" ON "business_rules" USING btree ("tenant_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_tenant_number_key" ON "gl_accounts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_one_default_ar" ON "gl_accounts" USING btree ("tenant_id") WHERE is_default_ar;--> statement-breakpoint
CREATE UNIQUE INDEX "payer_classes_tenant_code_key" ON "payer_classes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_sites_tenant_code_key" ON "rcm_sites" USING btree ("tenant_id","code");--> statement-breakpoint
ALTER TABLE "business_rules" ADD CONSTRAINT "business_rules_contra_bps_range" CHECK ("contra_bps" BETWEEN 0 AND 10000);--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_ar_routing" CHECK ("kind" <> 'ar' OR ("revenue_gl" IS NOT NULL AND "adjustment_gl" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_default_is_ar" CHECK (NOT "is_default_ar" OR "kind" = 'ar');--> statement-breakpoint

-- Tenant isolation for the revenue cycle setup tables (R-7.2.4, CLAUDE.md #5): same policy as
-- drizzle/0002_security.sql, no DELETE (R-9.2.1; rules are deactivated, not deleted).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rcm_sites', 'gl_accounts', 'payer_classes', 'business_rules']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO denialdesk_app', t);
  END LOOP;
END
$$;
