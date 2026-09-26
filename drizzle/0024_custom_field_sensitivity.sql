ALTER TABLE "custom_fields" ADD COLUMN "sensitivity" text;--> statement-breakpoint
-- Sensitive categories (R-3.5.1), the same keys as SENSITIVITY_TAGS in src/domain/patients/record.ts.
-- Values of a sensitive field are masked and opened with an audited reason (specs/settings-and-custom-fields.md).
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_sensitivity_valid"
  CHECK ("sensitivity" IS NULL OR "sensitivity" IN ('hiv', 'mental_health', 'sud', 'genetic', 'minor', 'reproductive_health'));
