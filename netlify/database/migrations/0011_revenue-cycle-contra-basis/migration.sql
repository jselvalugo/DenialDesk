-- Generated from drizzle/0011_revenue_cycle_contra_basis.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TYPE "public"."contra_basis" AS ENUM('percent', 'posted');--> statement-breakpoint
ALTER TABLE "business_rules" ADD COLUMN "contra_basis" "contra_basis" DEFAULT 'percent' NOT NULL;