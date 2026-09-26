-- Generated from drizzle/0016_revenue_cycle_deposit_guards.sql by `pnpm netlify:migrations`. Do not edit.
ALTER TABLE "rcm_deposit_files" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "rcm_deposit_files" ADD COLUMN "date_from" date;--> statement-breakpoint
ALTER TABLE "rcm_deposit_files" ADD COLUMN "date_to" date;--> statement-breakpoint
ALTER TABLE "rcm_deposit_files" ADD COLUMN "reverses_file_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_deposit_files_tenant_hash_key" ON "rcm_deposit_files" ("tenant_id", "content_hash") WHERE "content_hash" IS NOT NULL AND "reverses_file_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "rcm_deposit_files_one_reversal" ON "rcm_deposit_files" ("tenant_id", "reverses_file_id") WHERE "reverses_file_id" IS NOT NULL;--> statement-breakpoint
-- Foreign keys skip row-level security, so references carry the tenant.
CREATE UNIQUE INDEX "rcm_deposit_files_tenant_id_key" ON "rcm_deposit_files" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "rcm_deposits" ADD CONSTRAINT "rcm_deposits_tenant_file_fk" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "rcm_deposit_files" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "rcm_deposit_files" ADD CONSTRAINT "rcm_deposit_files_tenant_reverses_fk" FOREIGN KEY ("tenant_id", "reverses_file_id") REFERENCES "rcm_deposit_files" ("tenant_id", "id");--> statement-breakpoint
ALTER TABLE "rcm_deposits" ADD CONSTRAINT "rcm_deposits_date_plausible" CHECK ("deposit_date" BETWEEN DATE '2000-01-01' AND DATE '2100-12-31');--> statement-breakpoint
ALTER TABLE "rcm_deposit_files" ADD CONSTRAINT "rcm_deposit_files_has_rows" CHECK ("row_count" > 0);--> statement-breakpoint

-- The uploader of a deposit file belongs to its practice (foreign keys skip row-level security).
CREATE FUNCTION rcm_deposit_files_uploader() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = NEW.uploaded_by AND m.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'rcm_deposit_files_uploader: uploader is not a member of this practice';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER rcm_deposit_files_uploader BEFORE INSERT ON "rcm_deposit_files"
  FOR EACH ROW EXECUTE FUNCTION rcm_deposit_files_uploader();
--> statement-breakpoint
-- Backfill date ranges of files imported before this migration, tenant by tenant (FORCE RLS).
DO $$
DECLARE
  t uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.tenant_id', t::text, true);
    UPDATE rcm_deposit_files f SET date_from = r.min_date, date_to = r.max_date
      FROM (SELECT file_id, min(deposit_date) AS min_date, max(deposit_date) AS max_date
            FROM rcm_deposits WHERE tenant_id = t GROUP BY file_id) r
      WHERE f.tenant_id = t AND f.id = r.file_id AND f.date_from IS NULL;
  END LOOP;
  PERFORM set_config('app.tenant_id', '', true);
END
$$;
