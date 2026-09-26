-- DenialDesk's own revenue cycle model (C0): rules route accounts only; charges, payments, and
-- adjustments always post as recorded, so percentage contra and line exclusion are retired.
-- One-time pre-production change (synthetic data only, ADR 0003; no production database exists).
-- Irreversible: it drops columns from import records. Once production exists, record tables
-- change by adding columns only (PROJECT_STATE conventions).
ALTER TABLE "business_rules" DROP COLUMN "contra_bps";--> statement-breakpoint
ALTER TABLE "business_rules" DROP COLUMN "excluded";--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" DROP COLUMN "contra_bps";--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" DROP COLUMN "contra_cents";--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" DROP COLUMN "excluded";--> statement-breakpoint
ALTER TABLE "rcm_files" DROP COLUMN "contra_cents";--> statement-breakpoint
ALTER TABLE "rcm_files" DROP COLUMN "excluded_count";