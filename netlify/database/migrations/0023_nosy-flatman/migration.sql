-- Generated from drizzle/0023_nosy_flatman.sql by `pnpm netlify:migrations`. Do not edit.
ALTER TABLE "payers" ALTER COLUMN "edi_payer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payers" ALTER COLUMN "regime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payers" ADD COLUMN "source" text;