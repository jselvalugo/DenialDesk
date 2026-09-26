-- Generated from drizzle/0000_init.sql by `pnpm netlify:migrations`. Do not edit.
-- Baseline migration. No tables yet; the tenancy spec adds the first ones.
-- Convention for later migrations: tenant-owned tables enable row-level security and filter on
-- current_setting('app.tenant_id'), set per transaction by src/db (ADR 0001).
SELECT 1;
