# Threat model: platform operator console and its sign-in

Scope: `/operator` (console), `/operator/login`, `/operator/login/mfa[/setup]`;
`src/auth/{operator,operator-account,operator-actions,operator-email,session,credentials}.ts`,
`scripts/operator-credential.ts`.
Spec: `docs/specs/operator-login.md`. Data: practice-level metadata and counts (no PHI); the
operator credential and TOTP secret (encrypted); `operator.*` audit events (IDs and IP only).

| Threat | Control | Residual risk / owner |
|---|---|---|
| Practice or demo user reaches the console | Separate cookie and `auth_method = 'operator'`; `readSession` accepts a token only in its own cookie (integration test); `requireOperator` re-checks email and no-membership on every request, revoking (audited) otherwise | Low |
| Operator account used inside a practice | Operator has no membership; `/login` refuses it (same generic error); an account with a membership is never the operator | Low |
| Password guessing / account enumeration | Shared lockout (5 attempts, 15 min), per-network rate limits, decoy hash, generic errors, account always looked up (no timing split on the operator email) | Low |
| Stolen password | TOTP required, single-use codes, token rotated after MFA | **Not phishing-resistant**: R-7.2.2 requires WebAuthn for admins — production gate (ROADMAP) |
| Session theft or cross-site use | `__Host-` cookie, httpOnly, secure, **SameSite=Strict**; 15-min idle / 12-h absolute; server actions origin-checked | Low |
| Someone creates or resets the operator account | No setup page or endpoint; the account is provisioned only from `PLATFORM_OPERATOR_PASSWORD_HASH` in hosting configuration; a practice account with the configured email is never touched; rotation is audited | Control of the operator = control of hosting configuration (owner only; platform logs changes). The hash must be secret (offline guessing): scrypt N=2^17, 16-char minimum |
| Seed endpoint overwrites the operator account | Seed refuses when `SEED_ADMIN_EMAIL` is the operator email | Low |
| Unaccountable privileged activity | Every sign-in, failure, lockout, MFA enrollment, sign-out, replacement, forced revocation, credential provisioning/rotation/refusal (source: hosting configuration) and console action is audited with IDs | No just-in-time approval or session recording (R-7.2.5) — production gate (ROADMAP) |
| Console shows PHI | Practice name, kind, status, dates, team size, open-denial counts only; counts run per tenant under RLS | Low |
| An old deployment re-applies a retired credential (deploy link, rollback, stale slot) | Every applied credential's fingerprint is recorded; a retired one is never re-applied and sign-in on that deployment is refused, without ending the owner's sessions | Low |
| Hosting account compromised (can rewrite the operator credential) | Owner-only access to Netlify team / Azure configuration; rotations are audited | **Production gate**: phishing-resistant MFA on the hosting accounts; alert on `operator.credential_*` to a channel the owner doesn't solely control (R-7.2.6) |
| Single administrator (no separation of duties, no second holder) | Every privileged action audited | **Human decision**: written risk acceptance with compensating controls (independent periodic log review, sealed break-glass holder) before production |
