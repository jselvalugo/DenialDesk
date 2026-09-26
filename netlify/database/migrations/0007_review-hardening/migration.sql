-- Generated from drizzle/0007_review_hardening.sql by `pnpm netlify:migrations`. Do not edit.
ALTER TABLE "users" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_one_active_demo" ON "tenants" USING btree ("kind") WHERE kind = 'demo' and suspended_at is null;