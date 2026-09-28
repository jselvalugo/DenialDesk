-- Generated from drizzle/0042_integration_attestation_version.sql by `pnpm netlify:migrations`. Do not edit.
-- Records which wording version and language the U.S.-residency attestation text was shown in
-- (docs/specs/patient-integrations.md "PI1b"; security/compliance review PR #81, OA-057): both
-- columns are set only alongside us_residency_attested_by/_at (never independently), so no
-- CHECK ties them together here — same pattern as that pair, whose own "set together" CHECK
-- predates this migration (drizzle/0039) and is left as-is per the no-edit rule on 0039-0041.
ALTER TABLE "integration_connections" ADD COLUMN "us_residency_attestation_version" text;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "us_residency_attestation_locale" text;--> statement-breakpoint

-- Same column-grant pattern as the other attestation columns (drizzle/0039): UPDATE only, never
-- INSERT — the app role always records an attestation via a follow-up UPDATE in the same
-- transaction as the connection's own INSERT (see src/domain/integrations/connections.ts).
GRANT UPDATE ("us_residency_attestation_version", "us_residency_attestation_locale")
  ON "integration_connections" TO denialdesk_app;