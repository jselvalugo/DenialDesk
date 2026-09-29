CREATE TABLE "appeal_letter_attestations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appeal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"rendered_sha256" text NOT NULL,
	"attested_by" uuid NOT NULL,
	"attested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeal_letter_attestations_digest_shape" CHECK ("appeal_letter_attestations"."rendered_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "appeal_letter_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" "denial_category" NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"body" text NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeal_letter_templates_language_en" CHECK ("appeal_letter_templates"."language" = 'en'),
	CONSTRAINT "appeal_letter_templates_body_size" CHECK (length("appeal_letter_templates"."body") between 1 and 20000)
);
--> statement-breakpoint
CREATE TABLE "appeal_letter_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appeal_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"source_category" "denial_category",
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appeal_letter_versions_version_positive" CHECK ("appeal_letter_versions"."version" >= 1),
	CONSTRAINT "appeal_letter_versions_body_size" CHECK (length("appeal_letter_versions"."body") between 1 and 20000)
);
--> statement-breakpoint
ALTER TABLE "appeal_letter_attestations" ADD CONSTRAINT "appeal_letter_attestations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_attestations" ADD CONSTRAINT "appeal_letter_attestations_attested_by_users_id_fk" FOREIGN KEY ("attested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- The composite FK below needs this unique key to exist first.
CREATE UNIQUE INDEX "appeal_letter_versions_key" ON "appeal_letter_versions" USING btree ("tenant_id","appeal_id","version");--> statement-breakpoint
ALTER TABLE "appeal_letter_attestations" ADD CONSTRAINT "appeal_letter_attestations_version_fk" FOREIGN KEY ("tenant_id","appeal_id","version") REFERENCES "public"."appeal_letter_versions"("tenant_id","appeal_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_templates" ADD CONSTRAINT "appeal_letter_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_templates" ADD CONSTRAINT "appeal_letter_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_templates" ADD CONSTRAINT "appeal_letter_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_versions" ADD CONSTRAINT "appeal_letter_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_versions" ADD CONSTRAINT "appeal_letter_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_letter_versions" ADD CONSTRAINT "appeal_letter_versions_appeal_fk" FOREIGN KEY ("tenant_id","appeal_id") REFERENCES "public"."appeals"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appeal_letter_attestations_key" ON "appeal_letter_attestations" USING btree ("tenant_id","appeal_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "appeal_letter_templates_key" ON "appeal_letter_templates" USING btree ("tenant_id","category","language");--> statement-breakpoint

-- Appeal letters (docs/specs/appeals.md A2). Tenant isolation (R-7.2.4, CLAUDE.md #5): the same policy as
-- drizzle/0002_security.sql and 0029_appeals.sql. Isolation tests: test/integration/tenancy.test.ts.
-- Data classification: Restricted PHI by inheritance (HC-1.2: appeal letters and practice free text).
-- Grants follow the established pattern (table grants to denialdesk_app in the migration that creates the
-- table). The two history tables are append-only: SELECT, INSERT, and no UPDATE or DELETE.
ALTER TABLE "appeal_letter_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appeal_letter_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "appeal_letter_templates"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "appeal_letter_templates" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "appeal_letter_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appeal_letter_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "appeal_letter_versions"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "appeal_letter_versions" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "appeal_letter_attestations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appeal_letter_attestations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "appeal_letter_attestations"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "appeal_letter_attestations" TO denialdesk_app;
