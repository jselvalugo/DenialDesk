CREATE TYPE "public"."agreement_kind" AS ENUM('baa');--> statement-breakpoint
CREATE TYPE "public"."agreement_status" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TABLE "tenant_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "agreement_kind" DEFAULT 'baa' NOT NULL,
	"status" "agreement_status" DEFAULT 'active' NOT NULL,
	"effective_date" date NOT NULL,
	"expires_on" date,
	"signed_on" date NOT NULL,
	"practice_signer" text NOT NULL,
	"our_signer" text NOT NULL,
	"template_version" text NOT NULL,
	"note" text,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea" NOT NULL,
	"recorded_by" uuid NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_agreements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Deferred so a renewal can mark the previous agreement superseded (pointing at the new row) and
-- insert the new active row in one transaction under the one-active-per-practice index.
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_superseded_by_fk" FOREIGN KEY ("superseded_by_id") REFERENCES "public"."tenant_agreements"("id") ON DELETE no action ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE INDEX "tenant_agreements_tenant_idx" ON "tenant_agreements" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_agreements_one_active" ON "tenant_agreements" USING btree ("tenant_id","kind") WHERE status = 'active';
--> statement-breakpoint

-- Agreements are a platform record (docs/specs/practice-agreements.md): Confidential, never PHI.
-- The app role gets no privileges, and row-level security is enabled with no policies, so even a
-- stray GRANT would show practice sessions nothing.
-- Recorded fields never change and rows are never deleted (retention, REQUIREMENTS §9.2); the
-- only permitted change is the status transition when a newer agreement supersedes this one.
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_dates_valid"
  CHECK ("expires_on" IS NULL OR "expires_on" >= "effective_date");--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_size_matches"
  CHECK ("size_bytes" = length("content") AND "size_bytes" > 0);--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_superseded_consistent"
  CHECK (("status" = 'superseded') = ("superseded_by_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_not_self_superseded"
  CHECK ("superseded_by_id" IS DISTINCT FROM "id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION tenant_agreements_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'tenant_agreements rows are retained, never deleted';
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'a superseded agreement cannot change';
  END IF;
  IF ROW(NEW.id, NEW.tenant_id, NEW.kind, NEW.effective_date, NEW.expires_on, NEW.signed_on,
         NEW.practice_signer, NEW.our_signer, NEW.template_version, NEW.note, NEW.filename,
         NEW.content_type, NEW.size_bytes, NEW.sha256, NEW.content, NEW.recorded_by, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.tenant_id, OLD.kind, OLD.effective_date, OLD.expires_on, OLD.signed_on,
         OLD.practice_signer, OLD.our_signer, OLD.template_version, OLD.note, OLD.filename,
         OLD.content_type, OLD.size_bytes, OLD.sha256, OLD.content, OLD.recorded_by, OLD.created_at)
  THEN
    RAISE EXCEPTION 'tenant_agreements recorded fields are immutable';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER tenant_agreements_guard_row BEFORE UPDATE OR DELETE ON "tenant_agreements"
  FOR EACH ROW EXECUTE FUNCTION tenant_agreements_guard();--> statement-breakpoint
CREATE TRIGGER tenant_agreements_guard_truncate BEFORE TRUNCATE ON "tenant_agreements"
  FOR EACH STATEMENT EXECUTE FUNCTION tenant_agreements_guard();
