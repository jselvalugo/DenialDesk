ALTER TABLE "custom_fields" ADD COLUMN "show_in_list" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- S2 table-column addendum (docs/specs/settings-and-custom-fields.md): a sensitive field's values
-- are never listed, searched, or exported, so it can never be marked "Show in list".
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_show_in_list_not_sensitive"
  CHECK (NOT ("show_in_list" AND "sensitivity" IS NOT NULL));