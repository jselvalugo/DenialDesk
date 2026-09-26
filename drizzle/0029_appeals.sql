CREATE TYPE "public"."appeal_decision_outcome" AS ENUM('overturned_full', 'overturned_partial', 'upheld', 'withdrawn', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."appeal_level" AS ENUM('first_level', 'second_level', 'external_review', 'medicare_redetermination', 'medicare_qic', 'medicare_alj', 'medicare_council', 'medicare_federal_court');--> statement-breakpoint
CREATE TYPE "public"."appeal_status" AS ENUM('draft', 'in_review', 'ready', 'submitted', 'awaiting_decision', 'decided', 'withdrawn', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."appeal_submitted_method" AS ENUM('portal', 'fax', 'mail', 'electronic');--> statement-breakpoint
CREATE TABLE "appeal_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"appeal_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"denial_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"level" "appeal_level" NOT NULL,
	"previous_appeal_id" uuid,
	"status" "appeal_status" DEFAULT 'draft' NOT NULL,
	"deadline" date,
	"deadline_basis" text,
	"deadline_citation" text,
	"filed_by" uuid NOT NULL,
	"submitted_method" "appeal_submitted_method",
	"submitted_on" date,
	"tracking_reference" text,
	"follow_up_on" date,
	"decision_outcome" "appeal_decision_outcome",
	"decision_on" date,
	"recovered_cents" bigint,
	"close_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appeal_notes" ADD CONSTRAINT "appeal_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_notes" ADD CONSTRAINT "appeal_notes_appeal_id_appeals_id_fk" FOREIGN KEY ("appeal_id") REFERENCES "public"."appeals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeal_notes" ADD CONSTRAINT "appeal_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_denial_id_denials_id_fk" FOREIGN KEY ("denial_id") REFERENCES "public"."denials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_filed_by_users_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_claim_fk" FOREIGN KEY ("tenant_id","claim_id") REFERENCES "public"."claims"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_settings" ADD CONSTRAINT "practice_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appeal_notes_appeal_idx" ON "appeal_notes" USING btree ("appeal_id","created_at");--> statement-breakpoint
CREATE INDEX "appeals_queue_idx" ON "appeals" USING btree ("tenant_id","status","deadline");--> statement-breakpoint
CREATE INDEX "appeals_tenant_denial_idx" ON "appeals" USING btree ("tenant_id","denial_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appeals_tenant_id_key" ON "appeals" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_settings_tenant_key_key" ON "practice_settings" USING btree ("tenant_id","key");--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5): same policy as drizzle/0002_security.sql. An
-- isolation test in test/integration/tenancy.test.ts covers appeals and appeal_notes.
ALTER TABLE "appeals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appeals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "appeals"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "appeals" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "appeal_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appeal_notes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "appeal_notes"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "appeal_notes" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "practice_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practice_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "practice_settings"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "practice_settings" TO denialdesk_app;--> statement-breakpoint

-- A note can only point at an appeal of the same practice (FKs don't check tenant).
ALTER TABLE "appeal_notes" ADD CONSTRAINT "appeal_notes_appeal_fk"
  FOREIGN KEY ("tenant_id", "appeal_id") REFERENCES "public"."appeals"("tenant_id", "id");--> statement-breakpoint

-- Self-reference for escalation (used starting A3); a future appeal can only continue one of the
-- same practice.
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_previous_appeal_fk"
  FOREIGN KEY ("tenant_id", "previous_appeal_id") REFERENCES "public"."appeals"("tenant_id", "id");--> statement-breakpoint

ALTER TABLE "appeals" ADD CONSTRAINT "appeals_recovered_not_negative" CHECK ("recovered_cents" IS NULL OR "recovered_cents" >= 0);--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_recovered_requires_decision"
  CHECK ("recovered_cents" IS NULL OR "decision_outcome" IN ('overturned_full', 'overturned_partial'));--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_submitted_fields_together"
  CHECK (("submitted_method" IS NULL) = ("submitted_on" IS NULL));--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_decision_fields_together"
  CHECK (("decision_outcome" IS NULL) = ("decision_on" IS NULL));--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_close_reason_present"
  CHECK ("close_reason" IS NULL OR length(btrim("close_reason")) > 0);--> statement-breakpoint

ALTER TABLE "practice_settings" ADD CONSTRAINT "practice_settings_key_valid"
  CHECK ("key" ~ '^[a-z][a-z0-9_]{0,63}$');--> statement-breakpoint

-- Status can only move forward through the standard lifecycle, or out to withdrawn/dismissed from
-- submitted or awaiting_decision (spec: appeals.md A1 acceptance criteria).
CREATE OR REPLACE FUNCTION appeals_status_transition() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status = 'draft' AND NEW.status = 'in_review')
     OR (OLD.status = 'in_review' AND NEW.status = 'ready')
     OR (OLD.status IN ('draft', 'in_review', 'ready') AND NEW.status = 'submitted')
     OR (OLD.status = 'submitted' AND NEW.status = 'awaiting_decision')
     OR (OLD.status IN ('submitted', 'awaiting_decision') AND NEW.status = 'decided')
     OR (OLD.status IN ('submitted', 'awaiting_decision') AND NEW.status IN ('withdrawn', 'dismissed'))
  THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'appeal % cannot move from % to %', OLD.id, OLD.status, NEW.status;
END
$$;--> statement-breakpoint
CREATE TRIGGER appeals_status_transition BEFORE UPDATE ON "appeals"
  FOR EACH ROW EXECUTE FUNCTION appeals_status_transition();--> statement-breakpoint
