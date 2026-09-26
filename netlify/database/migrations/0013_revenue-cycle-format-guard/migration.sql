-- Generated from drizzle/0013_revenue_cycle_format_guard.sql by `pnpm netlify:migrations`. Do not edit.
-- Only known monthly-file layouts (1: before 2026-09-26, 2: month-end activity file).
-- Note on 0011: it was a one-time, irreversible pre-production change on synthetic data (ADR 0003)
-- that dropped columns from import records. Once production exists, record tables only gain
-- columns (PROJECT_STATE conventions). Applied migrations are never edited.
ALTER TABLE "rcm_files" ADD CONSTRAINT "rcm_files_format_version_known" CHECK ("format_version" IN (1, 2));
