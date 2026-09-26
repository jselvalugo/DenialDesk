CREATE TYPE "public"."contra_basis" AS ENUM('percent', 'posted');--> statement-breakpoint
ALTER TABLE "business_rules" ADD COLUMN "contra_basis" "contra_basis" DEFAULT 'percent' NOT NULL;