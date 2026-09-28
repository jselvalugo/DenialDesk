CREATE TABLE "university_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_at" timestamp with time zone,
	"requested_by" uuid,
	"granted_at" timestamp with time zone,
	"granted_by" uuid,
	"note" text,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "university_access" ADD CONSTRAINT "university_access_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_access" ADD CONSTRAINT "university_access_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_access" ADD CONSTRAINT "university_access_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_access" ADD CONSTRAINT "university_access_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "university_access_tenant_key" ON "university_access" USING btree ("tenant_id");
-- Tenant isolation (R-7.2.4, CLAUDE.md #5): same policy as drizzle/0002_security.sql; tests in
-- test/integration/university-access.test.ts. A practice session (app role) may only read the row
-- and record a request: column privileges keep granted_*/revoked_* out of its reach. The platform
-- operator grants and revokes as the owner role under the same policy (withTenantAsPlatform).
ALTER TABLE "university_access" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "university_access" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "university_access"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT ON "university_access" TO denialdesk_app;--> statement-breakpoint
GRANT INSERT ("tenant_id", "requested_at", "requested_by") ON "university_access" TO denialdesk_app;--> statement-breakpoint
GRANT UPDATE ("requested_at", "requested_by", "updated_at") ON "university_access" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "university_access" ADD CONSTRAINT "university_access_request_fields_together"
  CHECK (("requested_at" IS NULL) = ("requested_by" IS NULL));--> statement-breakpoint
ALTER TABLE "university_access" ADD CONSTRAINT "university_access_grant_fields_together"
  CHECK (("granted_at" IS NULL) = ("granted_by" IS NULL));--> statement-breakpoint
ALTER TABLE "university_access" ADD CONSTRAINT "university_access_revoke_requires_grant"
  CHECK ("revoked_at" IS NULL OR "granted_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "university_access" ADD CONSTRAINT "university_access_revoke_fields_together"
  CHECK (("revoked_at" IS NULL) = ("revoked_by" IS NULL) AND ("revoked_at" IS NULL) = ("revoke_reason" IS NULL));--> statement-breakpoint
ALTER TABLE "university_access" ADD CONSTRAINT "university_access_revoke_reason_present"
  CHECK ("revoke_reason" IS NULL OR length(btrim("revoke_reason")) > 0);
