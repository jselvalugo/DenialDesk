-- Generated from drizzle/0041_session_step_up_mfa.sql by `pnpm netlify:migrations`. Do not edit.
-- Step-up MFA (R-7.2.2): `sessions.mfa_verified_at` is when MFA last completed on the session
-- (sign-in or a step-up). Nullable: a session that predates this column has never recorded one, so
-- it must step up before its first gated action (fail closed). `sessions` is reached only through
-- the connection owner (no GRANT to denialdesk_app, drizzle/0020), so this adds no privilege.
ALTER TABLE "sessions" ADD COLUMN "mfa_verified_at" timestamp with time zone;--> statement-breakpoint

-- PI2a (security review L-3): the registry key can't be written apart from the URL it names.
-- `src/integrations/fhir/url-rules.ts` already guarantees the equality (the WHATWG parser lowercases
-- the host, the path is limited to unreserved ASCII, and the key lowercases the path); these make
-- the database refuse a writer that gets it wrong. A bare `token_endpoint_key = lower(token_endpoint)`
-- would evaluate to NULL, which a CHECK treats as passing, for a key written with no endpoint at all
-- (the very "key apart from the URL" case), so the second CHECK spells it out: no key, or a key that
-- equals the lowercased endpoint. An endpoint without a key stays allowed (discovery sets the
-- endpoint first; integration_registry_claim refuses a connection with no key). Every row written so
-- far went through url-rules (drafts from createConnection, the pinned sandbox row), and
-- token_endpoint / token_endpoint_key are NULL everywhere until discovery ships. ADD CONSTRAINT
-- validates existing rows and fails the migration, naming the constraint, if one doesn't satisfy it.
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_endpoint_key_matches_url"
  CHECK ("endpoint_key" = lower("base_url"));--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_token_endpoint_key_matches_url"
  CHECK ("token_endpoint_key" IS NULL
    OR ("token_endpoint" IS NOT NULL AND "token_endpoint_key" = lower("token_endpoint")));
