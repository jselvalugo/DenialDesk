# Spec: Separate platform operator sign-in

Status: done (2026-09-26) — requested by the product owner; revised 2026-09-26: the operator is
provisioned only from infrastructure configuration (no setup page), owner rebaseline
Roadmap item: platform operations (follows `demo-login-and-operator-console.md`)
Requirement IDs: R-7.2.3, R-7.2.7, R-7.2.9, R-7.5.1, R-15.1; partial: R-7.2.2 (TOTP, not yet
phishing-resistant), R-7.2.5 (no JIT approval), R-7.2.6 (recovery is audited but has no alert or
independent review yet) — all production gates in `docs/ROADMAP.md`

## Goal
The platform console (`/operator`) has its own sign-in, separate from practice sign-in, used only
by the platform owner. The operator account belongs to no practice, so the owner can provision
and test practices without being tied to the demo practice.

## User stories
- As the platform owner, I sign in at `/operator/login` with my operator account (password + two-step)
  and land in the console, whatever practice or demo session this browser also has.
- As the platform owner, I am the sole administrator: my operator account exists only because I put
  its credential in the hosting configuration. No page or endpoint can create or reset it.
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

Provisioning from infrastructure configuration (owner rebaseline, 2026-09-26)
- [x] There is no setup page or endpoint (`/operator/setup` is 404 everywhere). The account is
      provisioned from `PLATFORM_OPERATOR_EMAIL` plus `PLATFORM_OPERATOR_PASSWORD_HASH` (a scrypt hash
      made locally with `pnpm operator:credential`; secret in Netlify / Azure Key Vault).
- [x] On each operator sign-in and console request the app syncs the account from configuration:
      creates it (practice-free) if missing; if the configured hash changed, that is a **credential
      rotation** (recovery): new password, two-step enrollment and lockout cleared, every operator
      session ended. Never touches an account with a practice membership or a disabled account
      (recorded once per configuration as `operator.credential_refused`).
- [x] **Rotations only move forward.** Every applied credential's fingerprint (SHA-256 of email +
      hash; the hash itself isn't stored) is kept in `operator_credentials`. A deployment still
      carrying a retired credential (an old deploy link, a rollback, a stale slot) can never re-apply
      it: sign-in there is refused and it does not end the owner's sessions. At most one credential
      is active: applying a new one (new hash or new operator email) retires every other, and
      credential changes are serialized under one database lock.
- [x] The hash must use exactly the parameters `pnpm operator:credential` produces (scrypt N=2^17,
      r=8, p=1, 16-byte salt, 64-byte key). The public e2e test hash is refused on Netlify and in
      production. A seeded practice user can't take the operator email.
- [x] The console is off (sign-in refused, live sessions ended) unless both values are set and the
      hash is well-formed. `pnpm operator:credential` requires an interactive terminal (no echo) and a
      16-character minimum.
- [x] Production bootstrap and recovery are the same infrastructure step; production sign-in moves
      to Microsoft Entra ID with a hardware key (ROADMAP production gate).

Audit (R-7.5.1)
- [x] `operator.login_succeeded`, `operator.login_failed`, `operator.mfa_failed`,
      `operator.mfa_enrolled`, `operator.logout`, `operator.session_revoked`,
      `operator.credential_provisioned`, `operator.credential_rotated`, `operator.credential_refused`
      (no user actor: the source is hosting configuration; the request IP only triggered the sync);
      lockouts and expiry use the shared `auth.locked_out` / `auth.session_expired`. IDs only.

## Data / API changes
- No migration: `sessions.auth_method` is text; new value `operator` (tenant null).
- Server actions: `signInOperator`, `verifyOperatorMfa`, `confirmOperatorMfaEnrollment`,
  `signOutOperator`, `keepOperatorSessionAlive`.
- Env: `PLATFORM_OPERATOR_EMAIL` (an address used only for the console), `PLATFORM_OPERATOR_PASSWORD_HASH` (secret).
- Script: `pnpm operator:credential`.
- `SEED_ADMIN_EMAIL` / the seed endpoint now only manage the demo practice's admin, not the operator.

## Legal rules used
None.

## Out of scope
- ⚠️ R-7.2.2 requires **phishing-resistant MFA (WebAuthn/passkeys)** for admins. The operator uses
  TOTP for now; WebAuthn for the operator is a required follow-up before production.
- Multiple operators, operator roles, JIT/approved privileged access and session recording (R-7.2.5),
  impersonation.

## Security notes
- The console's sign-in page is now reachable by anyone; it reveals nothing beyond "a sign-in exists"
  and is protected like practice sign-in (generic errors, lockout, rate limits, MFA).
- Control of the operator account equals control of the hosting configuration: whoever can edit
  `PLATFORM_OPERATOR_PASSWORD_HASH` can reset it. That is the owner alone (Netlify team / Azure RBAC);
  the hosting platform logs configuration changes. `SEED_TOKEN` no longer has any operator power.
- The hash is not the password, but it must still be secret (it allows offline guessing); scrypt
  N=2^17 and a 16-character minimum make that expensive.
- The hosting account is now the root of trust: the Netlify team and Azure accounts that can edit
  configuration must use phishing-resistant MFA and be limited to the owner.
- Single administrator: the owner is credential issuer, operator, recovery path and reviewer. This
  needs a written risk acceptance with compensating controls before production (human decision;
  `docs/PROJECT_STATE.md` open items).
- The operator never has a practice membership, so it can't read PHI through practice pages; console
  queries stay practice-level metadata and counts (tenant-scoped via `withTenant`).

## Test evidence
- Unit (`src/auth/operator.test.ts`): `requireOperator` syncs configuration first, redirects, and
  revokes (audited with a reason) when the console isn't configured, the email changed, or the
  account has a practice membership.
- Integration: `session-realms.test.ts` (a token works only in its own cookie); `operator-account.test.ts`
  (configuration validity; provisioning is practice-free and audited once; rotation clears two-step
  and lockout and ends sessions; a practice account with the configured email is never touched;
  nothing happens when unconfigured); `seed-admin.test.ts` (seed refuses the operator email).
- E2E: the preview test server is configured with a synthetic operator hash, like production; the
  operator signs in while a demo session keeps working; practice and signed-out visitors go to
  `/operator/login`; each sign-in refuses the other side's accounts; `/operator/setup` is 404.
- Manual: `pnpm operator:credential` in a terminal: the password isn't echoed, the hash verifies, and
  it refuses to run without a terminal.

## Upgrade note (existing environments)
1. Run `pnpm operator:credential` on your own machine (clear the terminal afterwards).
2. In the hosting configuration set `PLATFORM_OPERATOR_EMAIL` to an address used only for the
   console (not `SEED_ADMIN_EMAIL`) and `PLATFORM_OPERATOR_PASSWORD_HASH` to the printed hash
   (secret), then redeploy.
3. Sign in at `/operator/login` and set up two-step verification. If an operator account already
   existed (from the old setup page), the first request applies the new credential as a rotation:
   its two-step is reset and its sessions end.
