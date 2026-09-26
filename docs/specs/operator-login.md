# Spec: Separate platform operator sign-in

Status: done (2026-09-26) — requested by the product owner
Roadmap item: platform operations (follows `demo-login-and-operator-console.md`)
Requirement IDs: R-7.2.2, R-7.2.3, R-7.2.5, R-7.2.7, R-7.2.9, R-7.5.1, R-15.1

## Goal
The platform console (`/operator`) has its own sign-in, separate from practice sign-in, used only
by the platform owner. The operator account belongs to no practice, so the owner can provision
and test practices without being tied to the demo practice.

## User stories
- As the platform owner, I sign in at `/operator/login` with my operator account (password + two-step)
  and land in the console, whatever practice or demo session this browser also has.
- As the platform owner setting up a pre-production environment, I create (or recover) my operator
  account at `/operator/setup` with the environment's setup code, then enroll two-step verification.
- As a practice user, I can't sign in to the console, and the operator account can't sign in to a practice.

## Acceptance criteria
Separate account
- [x] The operator is the one account whose email equals `PLATFORM_OPERATOR_EMAIL` and that has
      **no practice membership**. An account with a membership is never the operator, even if its
      email matches (fail closed).
- [x] Practice sign-in (`/login`) refuses the operator account with the usual generic error; operator
      sign-in refuses every other account the same way (no account enumeration).
- [x] Practices created from the console can't reuse the operator's email (existing unique check).

Separate sign-in and session
- [x] `/operator/login` → password → `/operator/login/mfa` (or `/mfa/setup` on first sign-in) → `/operator`.
- [x] Operator sessions use their own cookie (`__Host-dd_operator`) and `auth_method = 'operator'`,
      with no practice. Practice pages never accept an operator session and the console never accepts
      a practice or demo session, so both can exist in one browser without interfering.
- [x] Same protections as practice sign-in: MFA required, per-account lockout, per-network rate
      limits, single-use TOTP codes, token rotation after MFA, 15-minute idle and 12-hour absolute
      timeouts with the warning dialog (R-7.2.7), password policy (R-7.2.9).
- [x] Anyone without a verified operator session who opens `/operator` is sent to `/operator/login`.
- [x] The console header shows "Platform console", the operator's name and *Sign out*; no practice
      link. The practice sidebar no longer shows a *Platform console* link.

First-time setup and recovery (pre-production only)
- [x] `/operator/setup` (404 in production) takes the operator email, the setup code (`SEED_TOKEN`,
      compared in constant time), and a new password. It creates the operator account, or for an
      existing one resets the password, clears two-step enrollment and lockout, and ends its sessions.
      Then it continues to two-step enrollment.
- [x] Refused when `PLATFORM_OPERATOR_EMAIL` is unset, the email or code doesn't match (one generic
      message), or the email belongs to a practice account. Rate-limited (seed bucket, 5/hour).
- [x] Production bootstrap is a separate, human-approved runbook step (out of scope here).

Audit (R-7.5.1)
- [x] `operator.login_succeeded`, `operator.login_failed`, `operator.mfa_failed`,
      `operator.mfa_enrolled`, `operator.logout`, `operator.setup_completed`, `operator.setup_failed`;
      lockouts and expiry use the shared `auth.locked_out` / `auth.session_expired`. IDs only.

## Data / API changes
- No migration: `sessions.auth_method` is text; new value `operator` (tenant null).
- Server actions: `signInOperator`, `verifyOperatorMfa`, `confirmOperatorMfaEnrollment`,
  `signOutOperator`, `keepOperatorSessionAlive`, `setUpOperator`.
- Env: `PLATFORM_OPERATOR_EMAIL` (must name an address used only for the console), `SEED_TOKEN`.
- `SEED_ADMIN_EMAIL` / the seed endpoint now only manage the demo practice's admin, not the operator.

## Legal rules used
None.

## Out of scope
- ⚠️ R-7.2.2 requires **phishing-resistant MFA (WebAuthn/passkeys)** for admins. The operator uses
  TOTP for now; WebAuthn for the operator is a required follow-up before production.
- Multiple operators, operator roles, JIT/approved privileged access and session recording (R-7.2.5),
  impersonation, production bootstrap tooling.

## Security notes
- The console's sign-in page is now reachable by anyone; it reveals nothing beyond "a sign-in exists"
  and is protected like practice sign-in (generic errors, lockout, rate limits, MFA).
- Holding `SEED_TOKEN` in pre-production allows resetting the operator account (as the seed
  endpoint's admin repair already did). It must be marked secret in Netlify; production has no setup page.
- The operator never has a practice membership, so it can't read PHI through practice pages; console
  queries stay practice-level metadata and counts (tenant-scoped via `withTenant`).

## Test evidence
- Unit: operator email match, realm separation in session reads, `requireOperator` redirects.
- Integration: setup creates a membership-free account, re-running resets password/MFA/lockout and
  revokes sessions, refuses a practice account's email; console domain functions with the new context.
- E2E: operator signs in at `/operator/login` while a demo session stays usable; practice and signed-out
  visitors are sent to `/operator/login`; practice sign-in refuses the operator and vice versa; wrong
  setup code refused; `/operator/setup` is 404 in production.
