ALTER TABLE "rcm_claim_lines" ADD COLUMN "adjustment_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" ADD COLUMN "review_reasons" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "rcm_files" ADD COLUMN "adjustment_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rcm_files" ADD COLUMN "format_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "rcm_claim_lines" ADD CONSTRAINT "rcm_claim_lines_review_reasons_known" CHECK ("review_reasons" <@ ARRAY['no_activity', 'blank_code', 'invalid_code', 'after_period', 'credit_balance']::text[]);--> statement-breakpoint
ALTER TABLE "rcm_files" ADD CONSTRAINT "rcm_files_format_version_known" CHECK ("format_version" IN (1, 2));
