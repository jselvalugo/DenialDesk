CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"help_text" text,
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_tenant_entity_key" ON "custom_fields" USING btree ("tenant_id","entity","key");--> statement-breakpoint
CREATE INDEX "custom_fields_tenant_entity_idx" ON "custom_fields" USING btree ("tenant_id","entity","position");
-- Field definitions are checked here as well as in the app (src/domain/settings/custom-fields.ts).
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_entity_valid"
  CHECK ("entity" IN ('patient', 'claim', 'denial', 'payer'));--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_type_valid"
  CHECK ("field_type" IN ('text', 'long_text', 'number', 'date', 'checkbox', 'select'));--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_key_valid"
  CHECK ("key" ~ '^[a-z][a-z0-9_]{0,39}$');--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_label_present"
  CHECK (length(btrim("label")) BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_help_length"
  CHECK ("help_text" IS NULL OR length("help_text") <= 200);--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_options_match_type"
  CHECK (("field_type" = 'select') = (cardinality("options") >= 1) AND cardinality("options") <= 50);--> statement-breakpoint

-- Tenant isolation (R-7.2.4, CLAUDE.md #5): same policy as drizzle/0002_security.sql. No DELETE
-- grant (R-9.2.1): fields are deactivated, not deleted.
ALTER TABLE "custom_fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_fields" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "custom_fields"
  USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "custom_fields" TO denialdesk_app;
--> statement-breakpoint

-- What a field is (record type, key, type) never changes once created, so values recorded against
-- it keep their meaning; labels, help, choices, order, and active state may.
CREATE FUNCTION custom_fields_identity_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entity IS DISTINCT FROM OLD.entity OR NEW.key IS DISTINCT FROM OLD.key
     OR NEW.field_type IS DISTINCT FROM OLD.field_type OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'custom_fields identity is immutable';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER custom_fields_identity_immutable BEFORE UPDATE ON "custom_fields"
  FOR EACH ROW EXECUTE FUNCTION custom_fields_identity_immutable();
