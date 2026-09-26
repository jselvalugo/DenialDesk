-- Generated from drizzle/0025_lovely_mentor.sql by `pnpm netlify:migrations`. Do not edit.
ALTER TABLE "payers" ALTER COLUMN "edi_payer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payers" ALTER COLUMN "regime" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payers" ADD COLUMN "source" text;