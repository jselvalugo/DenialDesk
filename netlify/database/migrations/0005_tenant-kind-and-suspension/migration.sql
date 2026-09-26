-- Generated from drizzle/0005_tenant_kind_and_suspension.sql by `pnpm netlify:migrations`. Do not edit.
CREATE TYPE "public"."tenant_kind" AS ENUM('customer', 'demo');--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "kind" "tenant_kind" DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "suspended_at" timestamp with time zone;