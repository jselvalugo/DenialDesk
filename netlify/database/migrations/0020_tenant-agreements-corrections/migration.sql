-- Generated from drizzle/0020_tenant_agreements_corrections.sql by `pnpm netlify:migrations`. Do not edit.
-- Corrections to agreements on file (docs/specs/practice-agreements.md, owner decisions 2026-09-26):
-- an agreement can be marked "recorded in error" (voided, with a reason) and an older agreement
-- can be recorded for the file (historical) without replacing the current one. The template
-- version goes away: there is no BAA template, just the signed agreement per practice.
-- Status becomes text + CHECK so values can change in one migration (enum values added in a
-- transaction can't be used in the same migration).
ALTER TABLE "tenant_agreements" DROP CONSTRAINT "tenant_agreements_superseded_consistent";--> statement-breakpoint
-- The partial index predicate was compiled against the enum; rebuilt below against text.
DROP INDEX "tenant_agreements_one_active";--> statement-breakpoint
ALTER TABLE "tenant_agreements" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ALTER COLUMN "status" SET DEFAULT 'active';--> statement-breakpoint
DROP TYPE "public"."agreement_status";--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_agreements_one_active" ON "tenant_agreements" USING btree ("tenant_id","kind") WHERE status = 'active';--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_status_valid"
  CHECK ("status" IN ('active', 'superseded', 'historical', 'voided'));--> statement-breakpoint
-- A superseded row points at its successor; a voided row keeps that pointer if it had one.
ALTER TABLE "tenant_agreements" ADD CONSTRAINT "tenant_agreements_superseded_consistent"
  CHECK (("status" = 'superseded') <= ("superseded_by_id" IS NOT NULL)
         AND ("superseded_by_id" IS NULL OR "status" IN ('superseded', 'voided')));--> statement-breakpoint
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
$$;
--> statement-breakpoint
-- The function above no longer reads it, so the column can go.
ALTER TABLE "tenant_agreements" DROP COLUMN "template_version";
