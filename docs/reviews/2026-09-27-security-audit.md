# Review: whole-codebase security audit

Date: 2026-09-27 · Tree: `e66c0be` (DenialDesk University Wiki merged) · Branch: `claude/festive-ramanujan-5xizue`
Scheduled cybersecurity audit, not tied to a single PR. Read-only: nothing in `src/`, `rules/` or
`drizzle/` was changed to produce this review. Requirement IDs refer to `docs/REQUIREMENTS.md`.
Cross-checked against the findings already tracked in `docs/PROJECT_STATE.md` §"Deferred review
findings" and §"Decisions from the 2026-09-26 agent reviews" and against
`docs/reviews/2026-09-26-billing-structure-review.md`; only new items are reported here.

## 1. Verdict

No Critical or High findings. One new Medium finding (latent — no effect on the current Netlify
pre-production deployment, but must be fixed before the Azure cutover) and five new Low findings.

## 2. DenialDesk University and University Wiki (newest code, first review)

Checked and clean:
- **Tenant isolation on completions** — `drizzle/0033_university_progress.sql` has RLS
  enabled+forced with a `tenant_isolation` policy, the app role has only SELECT/INSERT, a CHECK on
  `lesson_id` shape, and a composite `(tenant_id, user_id)` FK to `memberships`. Reads/writes in
  `src/domain/university/queries.ts` run only inside `withTenant()`; `userId`/`tenantId` come from
  `requireAuth()`, never from client input. Completions are audited
  (`university.lesson_completed`); a repeat call is a no-op.
- **"Search by POST" (b99da7c)** — a privacy control, not a workaround: POST keeps the query out of
  the URL, browser history, and access logs (R-7.4.8). `searchWiki`
  (`src/app/(app)/university/wiki/actions.ts`) authenticates and authorizes, caps the query at 120
  chars, matches only in-memory article text (`String.includes`, no DB/fetch/redirect), and never
  logs the query. No SQLi/SSRF/open-redirect path found.
- **Legal content integrity** — `{{rule:id}}` tokens resolve only through `resolveRule` reading
  `rules/catalog.ts`; articles/lessons are TypeScript modules with no user write path. The Markdown
  renderer builds React elements only (no `dangerouslySetInnerHTML`); `isSafeHref` rejects
  protocol-relative/backslash hrefs; external links carry `rel="noopener noreferrer"`.
- **Auth** — every University/Wiki page and both server actions call `requireAuth()`; wiki pages
  are `force-dynamic` with no `generateStaticParams`.
- **PHI** — none in lessons, articles, or logs; the catalog has tests scanning for SSN/MBI/phone/
  email patterns.

No new finding in this module.

## 3. Confirmed new findings

### M1 — client IP is trusted from a Netlify-only header on every platform (blocks Azure cutover)

`src/lib/request-context.ts:18`:

```ts
const ip = h.get("x-nf-client-connection-ip") ?? h.get("x-azure-clientip") ?? forwarded?.at(-1) ?? null;
```

Netlify's header is checked first regardless of which platform is actually running. On a
non-Netlify deployment (the Dockerfile image, per ADR 0002) nothing strips a client-supplied
`x-nf-client-connection-ip`, so an attacker can set it to any value on every request; the same
applies to `x-azure-clientip` unless the app is confirmed to sit behind a proxy that overwrites it.

Impact:
- **Rate limiting** (ASVS V2.2.1, R-7.4.7): `limitCurrentRequest` keys per-IP buckets for
  `sign_in`/`mfa`/`seed`. A forged, ever-changing IP puts every request in a fresh bucket, so the
  per-IP limits disappear (the per-account lockout in `reserveAttempt` is unaffected, but password
  spraying across many accounts becomes unlimited).
- **Audit integrity** (ASVS V7.1, R-7.5.1): the `ipAddress` recorded on `auth.*`, `operator.*`, and
  `security.rate_limited` events can be forged, weakening the "where" of the audit trail.

Fix: select the trusted client-IP header from the deployment adapter (`src/platform/*`) rather
than a fixed precedence list — accept `x-nf-client-connection-ip` only when `onNetlify()`; on Azure
accept only the header the ingress layer is confirmed to overwrite. Add a test asserting a forged
Netlify header is ignored off Netlify.

This is distinct from the already-tracked Azure logging items (log-sink residency, otel span
params, migration output) — none of those cover trusted-header selection.

### L1 — rate-limit hash salt reuses the PHI field-encryption key

`src/lib/rate-limit.ts:31` derives the rate-limit lookup hash from `FIELD_ENCRYPTION_KEY`, the
AES-256 data-at-rest key (ASVS V6.4.1). One key serving two purposes pulls the PHI encryption key
into an unauthenticated code path (sign-in rate limiting) and complicates Key Vault scoping and
rotation (R-7.3.4); rotating the data key would also silently reset every rate-limit bucket.
Fix: a separate `RATE_LIMIT_SALT` secret, or an HKDF subkey under a distinct label.

### L2 — member-ID and TOTP-secret ciphertext has no AAD binding

`src/app/(app)/denials/[id]/actions.ts:180`, `src/app/(app)/appeals/[id]/actions.ts:206`,
`src/domain/patients/queries.ts:258,323,401`, `src/auth/enrollment.ts:23`. ADR 0007 binds
custom-field ciphertext to `tenant|field|record`, but member IDs and TOTP secrets are encrypted
without AAD (ASVS V6.2, R-7.3.3). With DB write access, one patient's `member_id_enc` (or one
user's `totp_secret_enc`) could be copied into another row and would still decrypt. Requires DB
write access to exploit, hence Low. Fix: encrypt with AAD `tenant_id|patient_id|member_id` and
`user_id|totp`, with a one-time re-encryption migration; bundle with the coverage-records work.
Distinct from the already-tracked "member-ID reveal on the wrong payer" item, which is about which
payer is revealed, not ciphertext binding.

### L3 — container base image and file ownership

`Dockerfile:2,8,16,20-22`, `.github/dependabot.yml`. `node:24-alpine` is not pinned by digest and
there is no `docker` Dependabot ecosystem, so the production base image can drift untracked
(R-7.4.2, R-15.7) even though CI actions are SHA-pinned. Runtime files are copied
`--chown=app:app`, so the app process can overwrite its own `server.js`/bundles if compromised
(ASVS V14.2). Fix: pin `node:24-alpine@sha256:...`, add a `package-ecosystem: docker` entry, copy
the app as root-owned/read-only (drop `--chown`, keep `USER app`), and consider a read-only root
filesystem at deploy time.

### L4 — local Postgres bound to all interfaces

`docker-compose.yml:10`: `"5432:5432"` binds the local dev Postgres on every interface with a
fixed password committed to the repo (`denialdesk-local-only`). Data is synthetic only, but on
shared Wi-Fi the DB is reachable from the LAN, which CLAUDE.md #1's "stays local" assumption
doesn't cover. Fix: `"127.0.0.1:5432:5432"`.

### L5 — moderate transitive advisory not caught by the CI gate

`pnpm-lock.yaml`: `exceljs 4.4.0 > uuid <11.1.1`. `pnpm audit --prod` reports GHSA-w5hq-g745-h8pq
(moderate), which CI's `--audit-level=high` doesn't block; it affects only uuid v3/v5/v6 called
with a `buf` argument, and reachability from exceljs wasn't verified here. `exceljs` 4.4.0 is a
2023 release with no newer version in the lockfile. Fix: add a pnpm `overrides` entry for
`uuid >= 11.1.1` if exceljs still works with it; record a decision on exceljs maintenance (R-15.7).

## 4. Worth a human look, not a vulnerability

- `.env.example` omits `SEED_TOKEN`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`,
  `PLATFORM_OPERATOR_EMAIL`, `PLATFORM_OPERATOR_PASSWORD_HASH`, `PLATFORM_OPERATOR_MFA`,
  `RATE_LIMIT_SIGNIN`, `RATE_LIMIT_MFA` — all read by the code. Documentation gap for the Key Vault
  inventory (R-7.3.5); list them (empty) in the example file.
- `PLATFORM_OPERATOR_MFA=off` (`src/auth/operator-account.ts:110`) is honored in any non-production
  `APP_ENV`. Already an owner decision for Netlify pre-prod — confirm it's meant to extend to a
  possible Azure staging environment too.

## 5. Checked, no new issue

Tenant isolation (`systemDb()` usage limited to auth/rate-limit/audit/seed/operator/preview code;
no `sql.raw` anywhere in `src/`), server-action auth+authz coverage, PHI kept out of URLs/logs,
upload validation (835/CSV/PDF size caps, encoding, magic bytes, audited rejections), xlsx export
formula-injection guard, CSP nonce + HSTS, session token hashing/rotation/timeouts, preview-route
constant-time token check and prod 404, and CI hardening (read-only permissions, SHA-pinned
actions, `persist-credentials: false`, gitleaks, non-root container).

## 6. New vs. already tracked

New (added to `docs/PROJECT_STATE.md` deferred findings): M1, L1, L2, L3, L4, L5.
Already tracked, not repeated: MFA enrollment by password only, shared DB owner role, role/field
matrix, synthetic NPI collisions, sensitivity-tag enforcement, composite FK validation in code,
WORM audit export, member-ID reveal on the wrong payer, `claims.status`/`paid_cents` versioning and
CHECK constraints, Azure log residency, Drizzle otel span params, migration output sanitization.

M1 and L3 touch audit-log integrity and the build pipeline, so per R-15.9 their fixes need owner
sign-off when made.
