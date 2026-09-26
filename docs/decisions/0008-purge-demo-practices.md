# ADR 0008: Purge the retired demo practices; the audit log keeps no foreign keys

Status: Accepted (2026-09-26, owner)

## Context
The one-click demo was removed (migrations 0021/0022), but its practices ("Sunrise Coast Medical
Group (demo)") were only archived, so they still showed in the platform console as practices. The
owner wants them gone so they are never mistaken for tenancies. Their data is synthetic.

`audit_events` referenced `tenants` and `users` by foreign key and is append-only (trigger), so a
practice with audit history could not be deleted without rewriting the log. Several practice tables
(`claim_versions`, `custom_field_value_versions`, `remittances`, `remittance_claims`,
`remittance_events`, `prompt_pay_responses`, `tenant_agreements`) also block deletes by trigger.

## Decision
- Migration 0029 drops the two `audit_events` foreign keys. Audit rows keep the tenant and user IDs
  as plain values, so the log outlives any purged practice or user. Its append-only triggers are
  unchanged: no audit event is updated or deleted.
- 0029 then deletes every `kind = 'demo'` practice with all its data, sessions and memberships, plus
  users whose only memberships were in demo practices (operators have none and are never matched).
  It writes one `system.demo_purged` audit event per practice (IDs only).
- The delete guards on the practice tables above are disabled only inside that migration's
  transaction and re-enabled before it commits. Customer practices are untouched.

## Consequences
- The console lists customer practices only. The `demo` enum value stays (removing an enum value
  needs a type rewrite) but no rows use it and nothing creates one.
- Audit reports must tolerate a tenant or actor ID with no matching row.
- Hard-deleting customer practice data still requires the offboarding / legal-hold flow (R-9.2.1);
  this migration is scoped to synthetic demo practices only.
