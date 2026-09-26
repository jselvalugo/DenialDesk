# Spec: Demo login and platform operator console

Status: done (2026-09-26) — requested by the product owner
Roadmap item: Phase 0 → pre-production demo; platform operations (new)
Requirement IDs: R-7.1.3, R-15.1, R-7.2.3, R-7.2.5, R-7.5.1, R-5.1.2

## Goal
Anyone evaluating the preview can explore DenialDesk with one click on synthetic data, and the
platform owner can see and manage every practice (tenant) from one place.

## User stories
- As a prospect on the preview site, I click "Explore the demo practice" and land in a working
  practice with realistic synthetic denials, without creating an account.
- As the platform operator (one person), I see all practices, create a practice with its first
  admin, suspend or reactivate a practice, and reset the demo practice.

## Acceptance criteria
Demo login
- [x] A demo practice, separate from every other tenant, is created with synthetic data on first
      use (no manual seeding). Its data lives in the preview database like any other tenant.
- [x] "Explore the demo practice" button on the sign-in page, shown only when `APP_ENV` is not
      `production` **and** `DEMO_LOGIN_ENABLED=true`. The server action enforces the same checks.
- [x] The demo session skips MFA — the only path that does — and can only ever reach the demo
      practice (a dedicated demo user with a membership in the demo tenant only).
- [x] Demo sessions follow the normal idle/absolute timeouts. Demo logins are audited.
- [x] The demo user can never be a platform operator.

Operator console (`/operator`)
- [x] Only the account whose email equals `PLATFORM_OPERATOR_EMAIL`, signed in with password
      **and** MFA, can open it. Everyone else (including demo sessions) gets a 404.
- [x] Lists every practice: name, kind (customer/demo), status, created date, team size, open
      denials. Shows practice-level metadata and counts only — never patient or claim data.
- [x] Create practice: name + first admin (name, email). Shows a one-time temporary password
      for the admin, who sets up MFA on first sign-in.
- [x] Suspend / reactivate a practice. Suspended practices' users can't sign in or use existing
      sessions.
- [x] Reset demo: archives the current demo practice (kept for the audit trail, never deleted)
      and creates a fresh one; the next demo login uses the new one.
- [x] Every operator action is audited with the target practice.

## Data / API changes
- `tenants.kind` (`customer` | `demo`), `tenants.suspended_at`.
- Server actions: `signInDemo`, `createPractice`, `setPracticeSuspended`, `resetDemoPractice`.
- Env: `DEMO_LOGIN_ENABLED`, `PLATFORM_OPERATOR_EMAIL`.

## Legal rules used
None.

## Out of scope
Multiple operators and operator roles, impersonation of practice users, billing, deleting
practices (retention/legal hold, R-9.2), Netlify deploy management (stays in Netlify).

## Security notes
- The MFA exception applies only to the synthetic demo tenant in non-production. Production
  can't enable it (checked in code, not just config).
- Operator access is by configured email plus a fully MFA-verified session. Cross-tenant counts
  run per tenant through `withTenant`, so RLS still applies.

## Test evidence
- Unit: operator check (configured email, case-insensitive; rejects demo sessions, demo guests, unset config).
- Integration: create practice (admin can sign in with the temporary password; MFA not yet
  enrolled; audited), duplicate email rejected, suspend/reactivate, can't suspend own practice,
  demo created once and reused, reset archives and replaces, practice list counts.
- E2E: one-click demo lands in the demo practice; demo, signed-out, and regular users get 404 on
  /operator; operator creates, suspends, and reactivates a practice; production hides the demo
  button even with DEMO_LOGIN_ENABLED=true.
