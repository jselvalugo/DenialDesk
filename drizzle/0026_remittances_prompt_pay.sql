CREATE TYPE "public"."prompt_pay_response_kind" AS ENUM('payment', 'denial', 'contest');--> statement-breakpoint
CREATE TYPE "public"."remittance_method" AS ENUM('check', 'eft', 'non_payment');--> statement-breakpoint
CREATE TYPE "public"."remittance_status" AS ENUM('received', 'posted', 'void');--> statement-breakpoint
CREATE TABLE "prompt_pay_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"kind" "prompt_pay_response_kind" NOT NULL,
	"response_date" date NOT NULL,
	"cents" bigint DEFAULT 0 NOT NULL,
	"remittance_id" uuid,
	"note" text,
	"voids_response_id" uuid,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remittance_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"remittance_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"status_code" text NOT NULL,
	"charge_cents" bigint NOT NULL,
	"paid_cents" bigint NOT NULL,
	"patient_responsibility_cents" bigint DEFAULT 0 NOT NULL,
	"payer_control_number" text,
	"adjustments" jsonb NOT NULL,
	"rarcs" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remittance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"remittance_id" uuid NOT NULL,
	"event" "remittance_status" NOT NULL,
	"reason" text NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "remittances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payer_id" uuid NOT NULL,
	"method" "remittance_method" NOT NULL,
	"trace_number" text NOT NULL,
	"payment_date" date NOT NULL,
	"total_paid_cents" bigint NOT NULL,
	"provider_adjustment_cents" bigint DEFAULT 0 NOT NULL,
	"status" "remittance_status" DEFAULT 'received' NOT NULL,
	"source" text NOT NULL,
	"loaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_pay_responses_tenant_id_key" ON "prompt_pay_responses" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_pay_responses_voids_key" ON "prompt_pay_responses" USING btree ("tenant_id","voids_response_id");--> statement-breakpoint
CREATE UNIQUE INDEX "remittances_tenant_id_key" ON "remittances" USING btree ("tenant_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "remittances_payer_trace_key" ON "remittances" USING btree ("tenant_id","payer_id","trace_number");--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ADD CONSTRAINT "prompt_pay_responses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ADD CONSTRAINT "prompt_pay_responses_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ADD CONSTRAINT "prompt_pay_responses_claim_fk" FOREIGN KEY ("tenant_id","claim_id") REFERENCES "public"."claims"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ADD CONSTRAINT "prompt_pay_responses_remittance_fk" FOREIGN KEY ("tenant_id","remittance_id") REFERENCES "public"."remittances"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ADD CONSTRAINT "prompt_pay_responses_voids_fk" FOREIGN KEY ("tenant_id","voids_response_id") REFERENCES "public"."prompt_pay_responses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_claims" ADD CONSTRAINT "remittance_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_claims" ADD CONSTRAINT "remittance_claims_remittance_fk" FOREIGN KEY ("tenant_id","remittance_id") REFERENCES "public"."remittances"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_claims" ADD CONSTRAINT "remittance_claims_claim_fk" FOREIGN KEY ("tenant_id","claim_id") REFERENCES "public"."claims"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_events" ADD CONSTRAINT "remittance_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_events" ADD CONSTRAINT "remittance_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_events" ADD CONSTRAINT "remittance_events_remittance_fk" FOREIGN KEY ("tenant_id","remittance_id") REFERENCES "public"."remittances"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_loaded_by_users_id_fk" FOREIGN KEY ("loaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_payer_fk" FOREIGN KEY ("tenant_id","payer_id") REFERENCES "public"."payers"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompt_pay_responses_claim_idx" ON "prompt_pay_responses" USING btree ("tenant_id","claim_id","response_date");--> statement-breakpoint
CREATE INDEX "remittance_claims_remittance_idx" ON "remittance_claims" USING btree ("tenant_id","remittance_id");--> statement-breakpoint
CREATE INDEX "remittance_claims_claim_idx" ON "remittance_claims" USING btree ("tenant_id","claim_id");--> statement-breakpoint
CREATE INDEX "remittance_events_remittance_idx" ON "remittance_events" USING btree ("tenant_id","remittance_id","created_at");--> statement-breakpoint
CREATE INDEX "remittances_tenant_date_idx" ON "remittances" USING btree ("tenant_id","payment_date");--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5). No DELETE grant anywhere (R-9.2.1). Remittance claims,
-- remittance events, and prompt-pay responses are append-only evidence; remittances change status only.
ALTER TABLE "remittances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "remittances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "remittances" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "remittances" TO denialdesk_app;--> statement-breakpoint
ALTER TABLE "remittance_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "remittance_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "remittance_claims" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "remittance_claims" TO denialdesk_app;--> statement-breakpoint
ALTER TABLE "remittance_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "remittance_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "remittance_events" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "remittance_events" TO denialdesk_app;--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "prompt_pay_responses" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT ON "prompt_pay_responses" TO denialdesk_app;--> statement-breakpoint

ALTER TABLE "remittances" ADD CONSTRAINT "remittances_trace_present" CHECK (length(btrim("trace_number")) BETWEEN 1 AND 50);--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_source_valid" CHECK ("source" IN ('upload', 'seed'));--> statement-breakpoint
ALTER TABLE "remittance_events" ADD CONSTRAINT "remittance_events_reason_present" CHECK (length(btrim("reason")) BETWEEN 1 AND 500);--> statement-breakpoint
ALTER TABLE "remittance_claims" ADD CONSTRAINT "remittance_claims_adjustments_array" CHECK (jsonb_typeof("adjustments") = 'array');--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ADD CONSTRAINT "prompt_pay_responses_cents_valid" CHECK ("cents" >= 0 AND ("kind" <> 'payment' OR "voids_response_id" IS NOT NULL OR "cents" > 0));--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ADD CONSTRAINT "prompt_pay_responses_void_reason" CHECK ("voids_response_id" IS NULL OR length(btrim(coalesce("note", ''))) > 0);--> statement-breakpoint
ALTER TABLE "prompt_pay_responses" ADD CONSTRAINT "prompt_pay_responses_note_length" CHECK ("note" IS NULL OR length("note") <= 500);--> statement-breakpoint

CREATE OR REPLACE FUNCTION remittance_evidence_immutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  RAISE EXCEPTION 'remittance and prompt-pay history is append-only';
END
$$;--> statement-breakpoint
CREATE TRIGGER remittance_claims_no_update BEFORE UPDATE OR DELETE ON "remittance_claims"
  FOR EACH ROW EXECUTE FUNCTION remittance_evidence_immutable();--> statement-breakpoint
CREATE TRIGGER remittance_claims_no_truncate BEFORE TRUNCATE ON "remittance_claims"
  FOR EACH STATEMENT EXECUTE FUNCTION remittance_evidence_immutable();--> statement-breakpoint
CREATE TRIGGER remittance_events_no_update BEFORE UPDATE OR DELETE ON "remittance_events"
  FOR EACH ROW EXECUTE FUNCTION remittance_evidence_immutable();--> statement-breakpoint
CREATE TRIGGER remittance_events_no_truncate BEFORE TRUNCATE ON "remittance_events"
  FOR EACH STATEMENT EXECUTE FUNCTION remittance_evidence_immutable();--> statement-breakpoint
CREATE TRIGGER prompt_pay_responses_no_update BEFORE UPDATE OR DELETE ON "prompt_pay_responses"
  FOR EACH ROW EXECUTE FUNCTION remittance_evidence_immutable();--> statement-breakpoint
CREATE TRIGGER prompt_pay_responses_no_truncate BEFORE TRUNCATE ON "prompt_pay_responses"
  FOR EACH STATEMENT EXECUTE FUNCTION remittance_evidence_immutable();--> statement-breakpoint
CREATE TRIGGER remittances_no_delete BEFORE DELETE ON "remittances"
  FOR EACH ROW EXECUTE FUNCTION remittance_evidence_immutable();--> statement-breakpoint
CREATE TRIGGER remittances_no_truncate BEFORE TRUNCATE ON "remittances"
  FOR EACH STATEMENT EXECUTE FUNCTION remittance_evidence_immutable();--> statement-breakpoint

-- "When" is the database clock and "who" is the signed-in user bound to the transaction (or NULL
-- for the system), never a value the caller chose.
CREATE OR REPLACE FUNCTION remittance_stamp_actor() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
DECLARE
  actor uuid;
BEGIN
  NEW.created_at := now();
  -- The actor column differs per table (TG_ARGV[0]); read it by name.
  actor := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF actor IS NOT NULL AND actor IS DISTINCT FROM nullif(current_setting('app.user_id', true), '')::uuid THEN
    RAISE EXCEPTION 'the recording user must be the current user';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER remittances_stamp BEFORE INSERT ON "remittances"
  FOR EACH ROW EXECUTE FUNCTION remittance_stamp_actor('loaded_by');--> statement-breakpoint
CREATE TRIGGER remittance_events_stamp BEFORE INSERT ON "remittance_events"
  FOR EACH ROW EXECUTE FUNCTION remittance_stamp_actor('actor_id');--> statement-breakpoint
CREATE TRIGGER prompt_pay_responses_stamp BEFORE INSERT ON "prompt_pay_responses"
  FOR EACH ROW EXECUTE FUNCTION remittance_stamp_actor('recorded_by');--> statement-breakpoint

-- Uploaded remittances start as received. Claim payments are written only while the remittance
-- is being loaded (same transaction), so posted evidence can't gain lines later.
CREATE OR REPLACE FUNCTION remittance_insert_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF TG_TABLE_NAME = 'remittances' THEN
    IF NEW.source = 'upload' AND NEW.status <> 'received' THEN
      RAISE EXCEPTION 'an uploaded remittance starts as received';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM remittances r WHERE r.id = NEW.remittance_id AND r.created_at = now()
  ) THEN
    RAISE EXCEPTION 'claim payments can only be added while the remittance is loaded';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER remittances_insert_rules BEFORE INSERT ON "remittances"
  FOR EACH ROW EXECUTE FUNCTION remittance_insert_rules();--> statement-breakpoint
CREATE TRIGGER remittance_claims_insert_rules BEFORE INSERT ON "remittance_claims"
  FOR EACH ROW EXECUTE FUNCTION remittance_insert_rules();--> statement-breakpoint

-- Only the status (and updated_at) of a remittance changes: received → posted or void, each with its
-- history row written first in the same transaction. Posted and void are final.
CREATE OR REPLACE FUNCTION remittances_guard_update() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.payer_id IS DISTINCT FROM OLD.payer_id
     OR NEW.method IS DISTINCT FROM OLD.method OR NEW.trace_number IS DISTINCT FROM OLD.trace_number
     OR NEW.payment_date IS DISTINCT FROM OLD.payment_date OR NEW.total_paid_cents IS DISTINCT FROM OLD.total_paid_cents
     OR NEW.provider_adjustment_cents IS DISTINCT FROM OLD.provider_adjustment_cents
     OR NEW.source IS DISTINCT FROM OLD.source OR NEW.loaded_by IS DISTINCT FROM OLD.loaded_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'remittance % is evidence; only its status changes', OLD.id;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'received' THEN
    RAISE EXCEPTION 'remittance % is final', OLD.id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM remittance_events e
    WHERE e.remittance_id = NEW.id AND e.event = NEW.status AND e.created_at = now()
  ) THEN
    RAISE EXCEPTION 'remittance % changed status without a history row', OLD.id;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER remittances_guard_update BEFORE UPDATE ON "remittances"
  FOR EACH ROW EXECUTE FUNCTION remittances_guard_update();--> statement-breakpoint

-- A correction ("recorded in error") points at a response of the same claim that is not itself a
-- correction, and repeats its kind.
CREATE OR REPLACE FUNCTION prompt_pay_responses_void_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.voids_response_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM prompt_pay_responses p
    WHERE p.id = NEW.voids_response_id AND p.claim_id = NEW.claim_id AND p.kind = NEW.kind
      AND p.voids_response_id IS NULL
  ) THEN
    RAISE EXCEPTION 'a correction must point at an original response of the same claim';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER prompt_pay_responses_void_rules BEFORE INSERT ON "prompt_pay_responses"
  FOR EACH ROW EXECUTE FUNCTION prompt_pay_responses_void_rules();
