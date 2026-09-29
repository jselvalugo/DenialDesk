/**
 * The integration service principal (docs/specs/patient-integrations.md "PI2b"; ADR 0010): the fixed
 * `users` row seeded by `drizzle/0043_patient_integrations_sync_engine.sql`. It is the audit actor of
 * every event the sync engine writes and the `updated_by` of the connection and payer-mapping rows the
 * engine touches (both NOT NULL foreign keys to `users`). It cannot sign in (its password hash is not a
 * hash `verifyPassword` accepts and the account is disabled), has no membership and so no role in any
 * practice, and has no MFA secret. A test pins this constant to the migration's row.
 *
 * Reviewed code, not configuration: the value is never read from the environment or the request.
 */
export const INTEGRATION_SERVICE_PRINCIPAL_ID = "d3a7c0de-5a1c-4e11-8a0c-0000000d0d01";
