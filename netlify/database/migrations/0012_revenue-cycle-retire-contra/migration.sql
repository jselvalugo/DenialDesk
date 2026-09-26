-- Generated from drizzle/0012_revenue_cycle_retire_contra.sql by `pnpm netlify:migrations`. Do not edit.
-- DenialDesk's own revenue cycle model (C0): rules route accounts only; charges, payments, and
-- adjustments always post as recorded, so the contra basis (0011, from an earlier draft of C0),
-- percentage contra, and line exclusion are retired. One-time, irreversible pre-production change
-- on synthetic data (ADR 0003); once production exists, record tables only gain columns.
ALTER TABLE "business_rules" DROP COLUMN "contra_basis";--> statement-breakpoint
ALTER TABLE "business_rules" DROP COLUMN "contra_bps";--> statement-breakpoint
ALTER TABLE "business_rules" DROP COLUMN "excluded";--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" DROP COLUMN "contra_bps";--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" DROP COLUMN "contra_cents";--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" DROP COLUMN "excluded";--> statement-breakpoint
ALTER TABLE "rcm_files" DROP COLUMN "contra_cents";--> statement-breakpoint
ALTER TABLE "rcm_files" DROP COLUMN "excluded_count";--> statement-breakpoint
DROP TYPE "public"."contra_basis";