-- Generated from drizzle/0046_claim_837p_billing_data.sql by `pnpm netlify:migrations`. Do not edit.
-- Claims C3a (docs/specs/claims.md): the billing details an 837P needs and the schema never held.
-- Nullable columns only: existing providers and locations stay null, so a claim that uses one refuses to
-- generate until its details are entered ("missing billing details", never a placeholder).
--
-- No new table, no policy change, and NO GRANT. `providers` and `locations` already carry the
-- table-level `SELECT, INSERT, UPDATE, DELETE` grant to `denialdesk_app` from drizzle/0002_security.sql,
-- which covers a column added later, and both keep their FORCE ROW LEVEL SECURITY tenant policy.
--
-- Data classification: the name and address are the provider's business name and address (Confidential,
-- not patient data); `tin_enc` is field-level encrypted (AES-256-GCM, CLAUDE.md #6) because a sole
-- proprietor's tax ID can be an SSN.
ALTER TABLE "locations" ADD COLUMN "place_of_service" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "tin_type" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "tin_enc" text;--> statement-breakpoint

-- Shapes the 837P generator also checks. The columns are new and null, so ADD CONSTRAINT cannot fail on
-- existing rows; a value written later that breaks a shape is refused by the database.
ALTER TABLE "locations" ADD CONSTRAINT "locations_place_of_service_shape"
  CHECK ("place_of_service" IS NULL OR "place_of_service" ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_state_shape"
  CHECK ("state" IS NULL OR "state" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_postal_code_shape"
  CHECK ("postal_code" IS NULL OR "postal_code" ~ '^[0-9]{5}(-?[0-9]{4})?$');--> statement-breakpoint
-- The tax ID and its type are stored together or not at all, and the type is the REF01 qualifier.
ALTER TABLE "providers" ADD CONSTRAINT "providers_tin_type_valid"
  CHECK ("tin_type" IS NULL OR "tin_type" IN ('EI', 'SY'));--> statement-breakpoint
ALTER TABLE "providers" ADD CONSTRAINT "providers_tin_together"
  CHECK (("tin_type" IS NULL) = ("tin_enc" IS NULL));
