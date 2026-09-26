-- Generated from drizzle/0027_appeals_review_fixes.sql by `pnpm netlify:migrations`. Do not edit.
CREATE UNIQUE INDEX "denials_tenant_id_key" ON "denials" USING btree ("tenant_id","id");--> statement-breakpoint
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_denial_fk" FOREIGN KEY ("tenant_id","denial_id") REFERENCES "public"."denials"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- A denial's claim can't change (claims_require_version already forbids it), so it's enough to
-- check this once at insert: an appeal's denormalized claim_id must be the same claim the denial
-- belongs to (composite FKs can't cross-check two columns against each other).
CREATE OR REPLACE FUNCTION appeals_claim_matches_denial() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM denials d WHERE d.id = NEW.denial_id AND d.claim_id = NEW.claim_id
  ) THEN
    RAISE EXCEPTION 'appeal %: claim % does not match the claim of denial %', NEW.id, NEW.claim_id, NEW.denial_id;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER appeals_claim_matches_denial BEFORE INSERT OR UPDATE OF claim_id, denial_id ON "appeals"
  FOR EACH ROW EXECUTE FUNCTION appeals_claim_matches_denial();--> statement-breakpoint

-- Notes are append-only in practice (no edit action exists); tighten the grant to match.
REVOKE UPDATE ON "appeal_notes" FROM denialdesk_app;