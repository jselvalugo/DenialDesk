# Spec: Tenancy, row-level security, and audit log skeleton

Status: done (2026-09-26) — approved by delegated technical authority
Roadmap item: Phase 0 → "Tenancy + RBAC skeleton…", "Immutable audit log skeleton"
Requirement IDs: R-7.2.3, R-7.2.4, R-7.3.3, R-7.5.1

## Goal
Practice data can only be read or written inside a tenant-bound transaction, enforced by
PostgreSQL, and every PHI access can be recorded in an append-only audit log.

## Acceptance criteria
- [x] Core schema: tenants, users, memberships, sessions, locations, providers, payers (with
      regulatory regime), patients, claims, claim lines, denials, denial notes, audit events.
- [x] Tenant-owned tables have RLS enabled and forced; policy `tenant_id = app_current_tenant()`.
- [x] App queries run as NOLOGIN role `denialdesk_app` via `withTenant()`; the role cannot read
      password hashes or MFA secrets.
- [x] Isolation tests: own rows only; other tenant's rows invisible by ID; cross-tenant insert,
      update-to-other-tenant, update, and delete all blocked; no tenant bound → no rows.
- [x] Audit events readable only by their tenant; UPDATE/DELETE/TRUNCATE blocked by trigger.
- [x] Member IDs stored AES-256-GCM encrypted with last-4 for display (R-7.3.3); tests for
      round-trip, randomized IV, tamper and wrong-key rejection.

## Known limits
- Foreign keys don't check tenant (PostgreSQL FK checks bypass RLS). Application code must
  validate that referenced IDs (assignee, payer, …) belong to the current tenant.
- The owner role could drop the audit trigger; production adds WORM export (R-7.5.1) at cutover.
- RBAC (role checks per action) arrives with the first role-restricted feature.
