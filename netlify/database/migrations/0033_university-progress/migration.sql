-- Generated from drizzle/0033_university_progress.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TABLE "university_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "university_progress" ADD CONSTRAINT "university_progress_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "university_progress" ADD CONSTRAINT "university_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "university_progress_tenant_user_lesson_key" ON "university_progress" USING btree ("tenant_id","user_id","lesson_id");
-- Tenant isolation (R-7.2.4, CLAUDE.md #5): same policy as drizzle/0002_security.sql; isolation
-- tests in test/integration/university.test.ts (the shared tenancy test assumes UPDATE is granted).
-- Completions are a training record (R-10.4): the app role can read and add rows but never change
-- or remove one.
ALTER TABLE "university_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "university_progress" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "university_progress"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "university_progress" TO denialdesk_app;--> statement-breakpoint

-- "<course>/<lesson>" slugs from src/domain/university/catalog.ts; never free text.
ALTER TABLE "university_progress" ADD CONSTRAINT "university_progress_lesson_id_valid"
  CHECK ("lesson_id" ~ '^[a-z0-9]+(-[a-z0-9]+)*/[a-z0-9]+(-[a-z0-9]+)*$');--> statement-breakpoint

-- A completion belongs to a member of the same practice (FKs bypass RLS; memberships has no RLS).
ALTER TABLE "university_progress" ADD CONSTRAINT "university_progress_member_fk"
  FOREIGN KEY ("tenant_id", "user_id") REFERENCES "public"."memberships"("tenant_id", "user_id");
