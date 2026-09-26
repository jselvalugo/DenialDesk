-- Generated from drizzle/0020_practice_agreements.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TYPE "public"."agreement_kind" AS ENUM('baa');--> statement-breakpoint
CREATE TABLE "tenant_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "agreement_kind" DEFAULT 'baa' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_date" date NOT NULL,
	"expires_on" date,
	"signed_on" date NOT NULL,
	"practice_signer" text NOT NULL,
	"our_signer" text NOT NULL,
	"note" text,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"recorded_by" uuid NOT NULL,
	"superseded_by_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_agreements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Deferred so a renewal can mark the previous agreement superseded (pointing at the new row) and
-- insert the new active row in one transaction under the one-active-per-practice index.
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."tenant_agreements"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE INDEX "tenant_agreements_tenant_idx" ON "tenant_agreements" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_agreements_one_active" ON "tenant_agreements" USING btree ("tenant_id","kind") WHERE status = 'active';--> statement-breakpoint

-- Agreements are a platform record (docs/specs/practice-agreements.md): Confidential, never PHI.
-- The app role gets no privileges, and row-level security is enabled with no policies, so even a
-- stray GRANT would show practice sessions nothing.
-- Status: active (in force, one per practice and kind), superseded (replaced by a newer recording),
-- historical (recorded for the file after a newer agreement was already active), voided (recorded
-- in error, kept with a reason). Text + CHECK rather than an enum so values can change in one
-- migration.
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_status_valid"
  CHECK ("status" IN ('active', 'superseded', 'historical', 'voided'));--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_dates_valid"
  CHECK ("expires_on" IS NULL OR "expires_on" >= "effective_date");--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_size_matches"
  CHECK ("size_bytes" = length("content") AND "size_bytes" > 0);--> statement-breakpoint
-- A superseded row points at its successor; a voided row keeps that pointer if it had one.
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_superseded_consistent"
  CHECK (("status" = 'superseded') <= ("superseded_by_id" IS NOT NULL)
         AND ("superseded_by_id" IS NULL OR "status" IN ('superseded', 'voided')));--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_not_self_superseded"
  CHECK ("superseded_by_id" IS DISTINCT FROM "id");--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_void_consistent"
  CHECK (("status" = 'voided') = ("voided_at" IS NOT NULL AND "voided_by" IS NOT NULL
         AND length(btrim(coalesce("void_reason", ''))) >= 5));--> statement-breakpoint

-- Recorded fields stay immutable and rows are never deleted (retention, REQUIREMENTS §9.2). The
-- only changes are the status transitions: active → superseded (pointing at the successor) and
-- active | superseded | historical → voided (with who, when, and why). A voided row is frozen.
CREATE OR REPLACE FUNCTION tenant_agreements_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'tenant_agreements rows are retained, never deleted';
  END IF;
  IF OLD.status = 'voided' THEN
    RAISE EXCEPTION 'a voided agreement cannot change';
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.kind, NEW.effective_date, NEW.expires_on, NEW.signed_on,
         NEW.practice_signer, NEW.our_signer, NEW.note, NEW.filename, NEW.content_type,
         NEW.size_bytes, NEW.sha256, NEW.content, NEW.recorded_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.kind, OLD.effective_date, OLD.expires_on, OLD.signed_on,
         OLD.practice_signer, OLD.our_signer, OLD.note, OLD.filename, OLD.content_type,
         OLD.size_bytes, OLD.sha256, OLD.content, OLD.recorded_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'tenant_agreements recorded fields are immutable';
  END IF;
  IF NEW.status = 'voided' THEN
    -- Any non-voided row may be voided; the void fields are set now and only now.
    IF OLD.voided_at IS NOT NULL OR NEW.superseded_by_id IS DISTINCT FROM OLD.superseded_by_id THEN
      RAISE EXCEPTION 'voiding may only set the void fields';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.voided_at IS NOT NULL OR NEW.voided_by IS NOT NULL OR NEW.void_reason IS NOT NULL THEN
    RAISE EXCEPTION 'void fields belong to voided agreements only';
  END IF;
  IF OLD.status = 'active' AND NEW.status = 'superseded' AND NEW.superseded_by_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.status = OLD.status AND NEW.superseded_by_id IS NOT DISTINCT FROM OLD.superseded_by_id THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'tenant_agreements status may only move to superseded or voided';
END
$$;--> statement-breakpoint
CREATE TRIGGER tenant_agreements_guard_row BEFORE UPDATE OR DELETE ON "tenant_agreements"
  FOR EACH ROW EXECUTE FUNCTION tenant_agreements_guard();--> statement-breakpoint
CREATE TRIGGER tenant_agreements_guard_truncate BEFORE TRUNCATE ON "tenant_agreements"
  FOR EACH STATEMENT EXECUTE FUNCTION tenant_agreements_guard();
