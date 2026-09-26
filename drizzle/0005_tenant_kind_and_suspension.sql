CREATE TYPE "public"."tenant_kind" AS ENUM('customer', 'demo');--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "kind" "tenant_kind" DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "suspended_at" timestamp with time zone;