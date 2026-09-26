# Threat model: platform operator console and its sign-in

Scope: `/operator` (console), `/operator/login`, `/operator/login/mfa[/setup]`, `/operator/setup`;
`src/auth/{operator,operator-account,operator-actions,operator-email,session,credentials}.ts`.
Spec: `docs/specs/operator-login.md`. Data: practice-level metadata and counts (no PHI); the
operator credential and TOTP secret (encrypted); `operator.*` audit events (IDs and IP only).

| Threat | Control | Residual risk / owner |
|---|---|---|
| Practice or demo user reaches the console | Separate cookie and `auth_method = 'operator'`; `readSession` accepts a token only in its own cookie (integration test); `requireOperator` re-checks email and no-membership on every request, revoking (audited) otherwise | Low |
| Operator account used inside a practice | Operator has no membership; `/login` refuses it (same generic error); an account with a membership is never the operator | Low |
| Password guessing / account enumeration | Shared lockout (5 attempts, 15 min), per-network rate limits, decoy hash, generic errors, account always looked up (no timing split on the operator email) | Low |
| Stolen password | TOTP required, single-use codes, token rotated after MFA | **Not phishing-resistant**: R-7.2.2 requires WebAuthn for admins — production gate (ROADMAP) |
| Session theft or cross-site use | `__Host-` cookie, httpOnly, secure, **SameSite=Strict**; 15-min idle / 12-h absolute; server actions origin-checked | Low |
| Setup page abused to take over the operator | Pre-production only (`APP_ENV` must be `development` or `preview`; 404 otherwise); setup code compared in constant time; 5 tries/hour per network; every attempt audited with a reason | **`SEED_TOKEN` doubles as the setup code**: anyone holding it can reset the operator's password and MFA (as the seed endpoint's repair already allowed). Human: keep shared or split into `OPERATOR_SETUP_TOKEN`; mark secret in Netlify |
| Seed endpoint overwrites the operator account | Seed refuses when `SEED_ADMIN_EMAIL` is the operator email | Low |
| Unaccountable privileged activity | Every sign-in, failure, lockout, MFA enrollment, sign-out, replacement, forced revocation, setup (with reason) and console action is audited with IDs | No just-in-time approval or session recording (R-7.2.5) — production gate (ROADMAP) |
| Console shows PHI | Practice name, kind, status, dates, team size, open-denial counts only; counts run per tenant under RLS | Low |
