-- Generated from drizzle/0031_insight_report_indexes.sql by `pnpm netlify:migrations`. Do not edit.
CREATE INDEX "claims_tenant_submitted_at_idx" ON "claims" USING btree ("tenant_id","submitted_at");--> statement-breakpoint
CREATE INDEX "claims_tenant_service_date_idx" ON "claims" USING btree ("tenant_id","service_date");--> statement-breakpoint
CREATE INDEX "denials_tenant_notice_date_idx" ON "denials" USING btree ("tenant_id","notice_date");