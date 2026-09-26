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
  IF EXISTS (SELECT 1 FROM remittances r WHERE r.id = NEW.remittance_id AND r.created_at = now()) THEN
    RETURN NEW;
  END IF;
  IF NEW.event = 'received' THEN
    RAISE EXCEPTION 'remittance % already has its loaded event', NEW.remittance_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM remittances r WHERE r.id = NEW.remittance_id AND r.status = 'received')
     OR EXISTS (SELECT 1 FROM remittance_events e WHERE e.remittance_id = NEW.remittance_id AND e.event <> 'received') THEN
    RAISE EXCEPTION 'remittance % is not ready to post', NEW.remittance_id;
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER remittance_events_rules BEFORE INSERT ON "remittance_events"
  FOR EACH ROW EXECUTE FUNCTION remittance_events_rules();
