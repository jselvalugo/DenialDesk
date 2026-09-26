-- DenialDesk's own revenue cycle model (C0): rules route accounts only; charges, payments, and
-- adjustments always post as recorded, so percentage contra and line exclusion are retired.
ALTER TABLE "business_rules" DROP COLUMN "contra_bps";--> statement-breakpoint
ALTER TABLE "business_rules" DROP COLUMN "excluded";--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" DROP COLUMN "contra_bps";--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" DROP COLUMN "contra_cents";--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" DROP COLUMN "excluded";--> statement-breakpoint
ALTER TABLE "rcm_files" DROP COLUMN "contra_cents";--> statement-breakpoint
ALTER TABLE "rcm_files" DROP COLUMN "excluded_count";