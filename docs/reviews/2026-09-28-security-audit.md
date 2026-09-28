# Security audit: full codebase review

Date: 2026-09-28 · Tree: `17aa0e8` (record pages merge on RecordHeader/RecordLayout) · Branch:
`claude/festive-ramanujan-r2m8t9`

Scheduled cybersecurity review of the entire codebase against `docs/REQUIREMENTS.md` §7 (OWASP
ASVS L2, auth, tenant isolation, encryption, secrets, IaC) and CLAUDE.md's non-negotiables. This is
a review, not a change — nothing in `src/`, `rules/`, `drizzle/` or CI config was modified.
Requirement IDs refer to `docs/REQUIREMENTS.md`.

## Verdict

No new Critical findings. One new High-severity detail on an already-tracked item, plus 7 new
Medium findings and 9 new Low findings. `pnpm audit` currently reports 0 high/critical and 2
moderate advisories. The custom-fields, payer-record, and RecordHeader/RecordLayout work merged
since the 2026-09-26 review held up well under this pass and produced no new High/Medium findings.

## Status of items already tracked in `docs/PROJECT_STATE.md`

Items 1, 2, 3, 5, 6, 7, 9, 10 (MFA enrollment, DB role separation, role/field matrix, sensitivity
tags, composite FKs, WORM audit export, payment invariants, Azure log residency) are all still
present as described; nothing in this pass changes their assessment except the two additions below.

- **Item 8 (member-ID reveal bound to the wrong payer)** also affects appeals, not just denials:
  `src/app/(app)/appeals/[id]/actions.ts:193-209` decrypts `patients.memberIdEnc` the same way
  `src/app/(app)/denials/[id]/actions.ts:169-185` does. Fix both together.
- **Item 5 (sensitivity tags not enforced)**: the member-ID reveal paths (denials, appeals, and
  `revealPatientMemberIdFor` in `src/domain/patients/queries.ts:397`) never check
  `sensitivityTags`, unlike custom-field reveals, which do go through `recordIsSensitive`.

Already known and not re-raised: operator two-step is off outside production (2026-09-26
decision); operator uses TOTP rather than WebAuthn (open item); agreement PDFs are not
malware-scanned (accepted in spec).

## Findings

### H1 — High (new detail on tracked item 1): pre-enrollment TOTP secret is reused and never rotated

- `src/auth/enrollment.ts:19-22`, `src/auth/credentials.ts:113-122`.
- `pendingEnrollmentSecret` returns the same stored `totpSecretEnc` to every password-authenticated
  session until enrollment completes. `claimTotp(enrolling=true)` sets `mfaEnrolledAt` but never
  rotates the secret.
- Exploit: anyone with a stolen or temporary password can open `/login/mfa/setup`, copy the QR
  secret, and leave without enrolling. When the legitimate user later enrolls, they enroll that
  same secret — giving the attacker a working second factor with no visible trace. Stealthier than
  the already-tracked "attacker enrolls their own authenticator" case.
- Fix: rotate the secret at the start of each enrollment session (bind it to the session), or adopt
  the admin-issued expiring enrollment link already recommended for item 1. Re-issue on confirmed
  enrollment.

### Medium (all new)

| # | Where | Issue | Exploit / impact | Fix |
|---|---|---|---|---|
| M1 | `src/lib/request-context.ts:18` | Trusted client-IP header order doesn't depend on the actual runtime platform (`x-nf-client-connection-ip` then `x-azure-clientip`) | On Azure, or without a fronting proxy, a client can forge whichever header is trusted and bypass per-IP sign-in/MFA rate limits (`src/lib/rate-limit.ts:66`) and forge the "where" in audit events (R-7.5.1). ⚠️ VERIFY whether Netlify overwrites a client-supplied `x-nf-client-connection-ip` | Select the trusted header by platform; verify before Azure cutover |
| M2 | `src/lib/rate-limit.ts:66-68` | Requests with no IP header share one `"unknown"` bucket | A misconfigured ingress (or local container) lets one client exhaust the shared sign-in/MFA allowance (30/15 min) and lock out everyone | Fail closed differently, or refuse to start in production without a trusted IP source |
| M3 | `src/auth/credentials.ts:61-84`, `src/auth/actions.ts:346` | 5 wrong passwords locks an account for 15 min, no CAPTCHA/step-up | Anyone who knows a user's email can lock them out repeatedly; combined with M1, one IP can rotate through many accounts | Needs a human decision: progressive delays vs. hard lock, or an unlock path |
| M4 | `src/domain/platform/practices.ts:110-122`; no expiry column in `src/db/schema.ts:76-77` | Operator-issued temporary passwords never expire | A leaked/intercepted temp password works forever until first use, letting the holder set their own password, enroll MFA, and take over the practice admin account | Add `temporary_password_expires_at` (e.g. 72h); fold into item-1 enrollment-link decision |
| M5 | `.github/workflows/ci.yml:105-133`, `Dockerfile:2,8,16` | No SAST/DAST/SBOM; container image built but never scanned; no IaC scan; `pnpm audit` only fails on high; base images pinned by tag not digest | Gaps against R-7.4.2/R-7.4.3. (Workflow itself is safe: no `pull_request_target`, no untrusted `${{ }}` in `run:`, SHA-pinned actions, `persist-credentials: false`, `contents: read`) | Add CodeQL, Trivy/Grype image scan, SBOM (syft/cyclonedx), digest-pin base images. **Needs sign-off under R-15.9** |
| M6 | `src/domain/patients/queries.ts:271,337`, `src/db/seed.ts:256`, `src/auth/enrollment.ts:19,23`, `src/auth/credentials.ts:111`, `denials/[id]/actions.ts:185`, `appeals/[id]/actions.ts:209` | Member IDs and TOTP secrets are encrypted with no AAD, unlike custom-field values (ADR 0007) | DB write access (item 2, a compromised owner login, a restore mix-up) lets ciphertext be copied across rows/tenants and still decrypt | Add AAD (`tenant_id\|patient_id\|member_id`, `user_id\|totp`) under a v2 format + migration |
| M7 | `src/auth/totp.ts`, whole practice sign-in flow | Practice users only have TOTP; R-7.2.2 requires phishing-resistant MFA (WebAuthn) for admins/PHI workforce; `PROJECT_STATE.md:268` only tracks this for the operator | Gap against R-7.2.2 for practice admins and PHI users | Track WebAuthn for practice admins/PHI users as a pre-production gate |

### Low (all new)

| # | Where | Issue |
|---|---|---|
| L1 | `src/db/demo.ts:38-47,108-113` | Seed endpoint matches the demo practice by name, not kind — a `SEED_TOKEN` holder could target any practice named identically. Pre-production only, synthetic data |
| L2 | `src/app/(app)/insight/[reportId]/export/route.ts:51-59`, `insight/export-all/route.ts:42-50` | Insight `.xlsx` exports lack `Cache-Control: no-store`, unlike other download routes |
| L3 | `src/lib/rate-limit.ts:31` | Field-encryption key doubles as the rate-limit hash salt, complicating Key Vault rotation (R-7.3.4) |
| L4 | `drizzle/0002_security.sql:52-53` | `audit_insert_tenant` allows `tenant_id IS NULL`, letting the app role insert tenant-less audit rows with arbitrary action/actor. **Needs sign-off under R-15.9** |
| L5 | `src/app/api/health/route.ts:9` | Public health check reveals `APP_ENV` and pings the DB with no rate limit |
| L6 | `next.config.ts:15` | 6 MB request body limit applies to every server action, not just the monthly-file upload |
| L7 | `src/auth/password.ts:44` | Breached-password screening (R-7.2.9) still missing; deferred to SSO in code but not in the tracked list |
| L8 | `src/auth/operator-account.ts:92,111`, `src/app/api/preview/seed/route.ts:15` | Operator MFA-skip, the seed endpoint, and accepting the public e2e operator hash all key off `APP_ENV` directly rather than the fail-safe `syntheticDataOnly()`/`onNetlify()` pattern used elsewhere — an Azure deployment misconfigured with `APP_ENV=preview` would open all three |
| L9 | `package.json` (`exceljs@4.4.0`) | Weakly maintained (no release since 2023); pulls deprecated transitive packages and a moderate `uuid` advisory (GHSA-w5hq-g745-h8pq) — R-15.7. (The other moderate advisory, `esbuild` via drizzle-kit, is dev-only: GHSA-67mh-4wv8-2f99) |

## Checked and found sound

- **Custom fields:** AAD binding; `custom_field_values_guard` trigger (tenant, entity match,
  immutable identity); lock-then-token concurrency check; payer role enforced in the domain
  (`values.ts:463`); list values exclude sensitive fields/tagged patients; sensitivity changes are
  audited.
- **Record pages:** role gates on fields edit pages/actions, which audit views
  (`claim.viewed` with `view: custom_fields`); no PHI in page titles.
- **RLS:** every tenant table has ENABLE+FORCE RLS plus a policy; `sessions`, `rate_limits`,
  `operator_credentials` have no app-role grants.
- **Role checks:** every server action calls `requireAuth`/`requireOperator` and checks role in the
  action or domain layer.
- **CSRF:** server actions use the framework's origin check; POST routes use `isSameOrigin`.
- **Other:** CSP nonce; HSTS; `__Host-` cookies; token rotation after MFA; idle/absolute session
  timeouts; CSV/Excel formula neutralization; 835 parser errors contain no PHI; search is POST; URL
  filters are enums/UUIDs; logger allowlist; no `dangerouslySetInnerHTML` except the QR SVG.

## Needs a human decision

- H1 and M4, together with tracked item 1: how enrollment and temporary credentials should work.
- M3: the account-lockout trade-off.
- M5 and L4: CI security gates and audit-logging change — sign-off under R-15.9.
- M7: WebAuthn scope for practice users.
- L9: keep or replace `exceljs`.

Owner action items for any of the above that require data, accounts, or a decision should be added
to `docs/owner/OWNER_ACTION_ITEMS.xlsx` per `docs/OWNER_ACTIONS.md`.
