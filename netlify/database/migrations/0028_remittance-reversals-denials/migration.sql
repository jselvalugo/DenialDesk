-- Generated from drizzle/0028_remittance_reversals_denials.sql by `pnpm netlify:migrations`. Do not edit.
ALTER TABLE "denials" ADD COLUMN "remittance_id" uuid;--> statement-breakpoint
ALTER TABLE "denials" ADD CONSTRAINT "denials_remittance_fk" FOREIGN KEY ("tenant_id","remittance_id") REFERENCES "public"."remittances"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "denials_remittance_idx" ON "denials" USING btree ("tenant_id","remittance_id");--> statement-breakpoint

-- History rows must describe a real change: "received" only while the remittance is being loaded,
-- "posted"/"void" only while it is still ready to post (or being loaded, e.g. seed), and once.
CREATE OR REPLACE FUNCTION remittance_events_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  -- Who: a signed-in user records their own events; only seeded (system) remittances have none.
  IF NEW.actor_id IS NULL AND nullif(current_setting('app.user_id', true), '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM remittances r WHERE r.id = NEW.remittance_id AND r.source = 'seed') THEN
    RAISE EXCEPTION 'remittance history needs the signed-in user';
  END IF;
  -- Each event at most once, and at most one of posted / void.
  IF EXISTS (
    SELECT 1 FROM remittance_events e
    WHERE e.remittance_id = NEW.remittance_id
      AND (e.event = NEW.event OR (e.event <> 'received' AND NEW.event <> 'received'))
  ) THEN
    RAISE EXCEPTION 'remittance % already has this history event', NEW.remittance_id;
  END IF;
  -- While loading (same transaction), any first event is allowed (the seed loads posted remittances).
  IF EXISTS (SELECT 1 FROM remittances r WHERE r.id = NEW.remittance_id AND r.created_at = now()) THEN
    RETURN NEW;
  END IF;
  IF NEW.event = 'received' THEN
    RAISE EXCEPTION 'remittance % already has its loaded event', NEW.remittance_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM remittances r WHERE r.id = NEW.remittance_id AND r.status = 'received') THEN
    RAISE EXCEPTION 'remittance % is not ready to post', NEW.remittance_id;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER remittance_events_rules BEFORE INSERT ON "remittance_events"
  FOR EACH ROW EXECUTE FUNCTION remittance_events_rules();
