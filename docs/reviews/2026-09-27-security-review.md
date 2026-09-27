# Security review: whole-codebase audit

Date: 2026-09-27 · Tree: `52fc607` (demo-practice purge merged) · Branch: `claude/festive-ramanujan-umcgnq`

Scheduled cybersecurity audit, not tied to a single PR. Four parallel reviews covered: (1)
authentication, sessions, MFA, RBAC, tenant isolation/RLS; (2) cryptography, secrets, PHI-in-logs,
data residency; (3) injection, input validation, X12/CSV ingestion, route handlers; (4) CI/CD,
dependencies, IaC. This is a review, not a change — nothing in `src/`, `rules/`, or `drizzle/` was
modified. Two High findings were independently re-verified against the source by the coordinating
session. Requirement IDs refer to `docs/REQUIREMENTS.md`. Findings already tracked in
`docs/PROJECT_STATE.md` are not repeated here unless this review found them to be worse than
described.

## Verdict

No exploitable cross-tenant IDOR, no committed secrets, no unparameterized SQL, and RLS is enabled
and forced on every tenant-scoped table. **Two High findings are real and should be fixed before
more real usage accumulates**: a denial-of-service in the 835/X12 parser reachable by any user who
can upload a remittance file, and a TOTP-enrollment flaw that lets anyone who obtains a user's
password permanently plant a working second factor without the victim ever noticing. Everything
else is Medium or Low, several already tracked in `PROJECT_STATE.md` as known pre-production risks.

## High findings (fix before more real usage)

### 1. ReDoS in the X12 tokenizer — `src/edi/x12/segments.ts:57`

```js
const cleaned = raw.replace(/^[\r\n]+/, "").replace(/[\r\n]+$/, "");
```

`[\r\n]+$` has no `^` anchor, so on a segment that does not end in a newline the engine retries the
match starting at every offset, giving quadratic-or-worse behavior on a long run of CR/LF
characters. Measured: 20k newlines → 189 ms, 40k → 660 ms, 80k → 2.5 s (worse than quadratic in
practice). A single segment can be close to the full `MAX_X12_BYTES` (5 MB) since segments are only
split on the declared segment terminator, so a crafted 835 upload well under the 5 MB limit can
block the Node event loop for a very long time — stalling every tenant on that instance. Reachable
by any user with `canPostRemittances`.

**Fix:** replace both regex trims with a plain index scan for char codes 10/13 (no regex), and cap
segment length/count in `tokenize()` independently of the overall byte cap.

### 2. TOTP enrollment secret is reusable and never rotated — `src/auth/enrollment.ts:15-26`

```js
if (user.totpSecretEnc) return { secret: decryptField(user.totpSecretEnc), email: user.email };
const secret = generateTotpSecret();
await systemDb().update(users).set({ totpSecretEnc: encryptField(secret) })...
```

The pending secret is generated once and persisted the first time *anyone* with a password-only
session (`mfaVerified: false`) opens the MFA setup page, then handed back unchanged on every later
visit. `claimTotp` (enrollment confirmation) never rotates it. So an attacker who has only the
victim's password can open `/login/mfa/setup` before the real user ever does, capture the secret,
and walk away — no completed enrollment, nothing for the victim to notice. When the real user later
opens the same setup page, they are shown and enroll with that same already-captured secret and see
nothing wrong. The attacker now holds a permanent, working second factor for that account. This is
worse than the risk already tracked in `PROJECT_STATE.md` ("stolen password could let an attacker
enroll their own authenticator") — the attacker doesn't need to race to finish enrollment first, and
the compromise is invisible to the victim indefinitely.

**Fix:** generate a fresh secret per setup attempt, bind it to the session (or expire after a few
minutes if unconfirmed), and never re-serve a previously issued secret. Regenerate on confirmed
enrollment. The already-tracked long-term fix (admin-issued, expiring enrollment links) still
applies and would close this more thoroughly.

## Medium findings

| # | Location | Risk | Fix |
|---|---|---|---|
| 3 | `src/domain/remittances/records.ts:87,107` | Quadratic `indexOf`-based duplicate check (~90s CPU for a maximal 835) plus `inArray(...)` can exceed Postgres's 65,535 bind-parameter limit | Dedupe with a `Set`/`Map`; cap claims per 835 (e.g. 10k) with a typed `Edi835Error` |
| 4 | `src/edi/x12/835.ts:63,231-252,282,367,372` | CLP/CAS amounts and CARC/RARC/TRN/N1 values have no length or format bounds (R-7.4.6); `parseInt` can yield `Infinity` or lose precision | Bound digit counts, require `Number.isSafeInteger`, apply 005010 max field lengths, validate CARC/RARC shape |
| 5 | `src/domain/platform/agreements.ts:84` | Uploaded signed-agreement PDFs get magic-byte/extension/size checks only, no malware scan (R-7.4.6) | **Human decision:** pick a scanner, confirm U.S.-region processing |
| 6 | `src/lib/rate-limit.ts:12` | Only `sign_in`/`mfa`/`seed` are rate-limited; remittance/monthly-file/deposit uploads and both Insight xlsx exports are not — compounds findings #1 and #3 | Add per-user `upload` and `export` buckets |
| 7 | `src/lib/request-context.ts:92` | IP resolution tries the Netlify header before the Azure header with no platform check; on Azure, a client-supplied `x-nf-client-connection-ip` would be trusted, letting an attacker spoof the IP used for rate-limiting and for the audit "where" field (R-7.5.1) — enables password spraying past per-IP lockout | Select the header by platform (`onNetlify()`), never fall through to another platform's header |
| 8 | `src/auth/operator-account.ts:110-112` | Operator MFA is skipped whenever `APP_ENV !== "production"` (string match), not by platform detection — a misconfigured Azure environment (e.g. `APP_ENV=preview`) would run the admin console on a password alone | **Human decision (R-15.9):** also require `onNetlify()`; revisit the 2026-09-26 "MFA off" decision before real tenants exist |
| 9 | `src/lib/crypto` usage sites (`patients/queries.ts:258,323`, `db/seed.ts:256`, `auth/enrollment.ts:23`, `auth/credentials.ts:99`) | Encrypted fields (member ID, TOTP secret) carry no AAD binding to tenant/record — a ciphertext could be copied to another row/tenant and still decrypt | Bind AAD to `tenant_id\|table\|record_id`; needs a re-encryption migration |
| 10 | `src/db/client.ts:25-30` | No explicit `ssl` option on the Postgres pool; TLS depends entirely on `sslmode` in the connection string (R-7.3.1) | Azure adapter should set `ssl: { rejectUnauthorized: true, minVersion: "TLSv1.2" }` and refuse to start without TLS outside local/CI |
| 11 | `src/db/client.ts:17`, `drizzle.config.ts:6` | App runs as the schema-owning DB role; `systemDb()` bypasses RLS and has no import restriction (already tracked, confirmed still true) | **Human decision (R-15.9):** separate migration-owner vs. restricted runtime login; add an ESLint `no-restricted-imports` guard on `systemDb` |
| 12 | `Dockerfile:1,8,16`, `ci.yml:44,72` | Base images (`node:24-alpine`, `postgres:16`) are floating tags, not digest-pinned, unlike the SHA-pinned GitHub Actions | Pin with `@sha256:…`; add a Dependabot `docker` ecosystem entry |
| 13 | `netlify.toml:7-12`, `docs/decisions/0003-netlify-preproduction.md:11,30` | Netlify Database region still unverified for U.S.-only residency (non-negotiable 3); no region pin | **Human decision:** confirm and record the region in the ADR; consider access-protecting preview URLs |

## Low findings (selected; full detail in agent transcripts)

- `src/lib/log.ts:27` — the `…Id`/`status` key allowlist accepts any string value, not just UUIDs/enum-shaped strings, so a careless future caller could pass PHI through a key that merely matches the pattern.
- `src/lib/rate-limit.ts:31` — `FIELD_ENCRYPTION_KEY` doubles as the rate-limit hash salt, breaking key separation; falls back to `""` if unset.
- `src/auth/password.ts:29-32` — `verifyPassword` trusts whatever scrypt N/r/p are stored in the hash rather than enforcing a floor.
- `src/db/demo.ts:38-46` — `repairAdmin` matches the demo tenant by name, not `kind='demo'`; a same-named customer practice could be affected pre-production.
- `drizzle/0032_purge_demo_practices.sql:13,112` — leaves `purge_demo_practices()` installed post-migration; a compromised schema-owner app connection could invoke it.
- `drizzle/0002_security.sql:52-53` — `audit_insert_tenant` rule allows the restricted app role to insert audit rows with `tenant_id IS NULL`.
- `docker-compose.yml:9-10` — local Postgres binds `0.0.0.0:5432` with a known password; bind to `127.0.0.1` instead.
- `next.config.ts:4-10` — no Content-Security-Policy header.
- `ci.yml:119` — `pnpm audit --audit-level=high` passes 2 current moderate advisories (esbuild via drizzle-kit, dev-only; uuid via exceljs) silently.
- `ci.yml:126-133` — the built container image is never vulnerability-scanned.
- `src/domain/insight/filters.ts:37` — an invalid `payerId` silently becomes "all payers" instead of a validation error.
- `src/app/(app)/remittances/actions.ts:51` — the pre-production synthetic-data attestation for 835 uploads is a checkbox only (unlike monthly-file/deposit imports, which check an in-file marker), and a missing attestation isn't audited via `rejected(...)`.

## Checked and found sound

- **RLS/tenant isolation:** every tenant-scoped table has RLS enabled and forced with a
  `tenant_isolation` policy; no migration disables it (0032 only toggles append-only triggers).
  `systemDb()` outside auth code is confined to the operator console (behind `requireOperator`),
  preview routes (behind `SEED_TOKEN`, rate-limited, 404 in production), and audit.
- **Sessions:** 256-bit tokens stored as SHA-256 hashes, `__Host-` cookie prefix, rotation after MFA,
  server-enforced idle/absolute timeouts, disabled users/removed memberships rejected per request.
- **Field encryption:** AES-256-GCM, random 96-bit IV, tag verified, versioned format, 32-byte key
  enforced. Passwords: scrypt N=2^17 with `timingSafeEqual`. TOTP: atomic single-use step claims.
- **CSRF/SSRF/injection:** all state changes go through Next.js Server Actions (origin-checked) or
  the two `isSameOrigin()`-guarded Insight export routes; no `sql.raw`/string-built SQL anywhere; no
  `eval`, `child_process`, dynamic `require`, or outbound `fetch`; no secrets found committed
  anywhere in tracked files.
- **CI/CD:** all GitHub Actions pinned to verified commit SHAs; workflow token is `contents: read`
  only; checkout uses `persist-credentials: false`; gitleaks runs over full history; Dependabot
  covers both `npm` and `github-actions`; Dockerfile runs as non-root.
- **PHI-in-logs:** no `console.*`/`JSON.stringify(err)` calls found in `src`/`scripts`/`netlify`;
  error paths log only route, digest, error name, and SQLSTATE; all list-page URL filters are
  enums/UUIDs/dates (patient search is POST, not GET).

## Suggested next steps

1. Fix finding #1 (ReDoS) and #2 (TOTP enrollment reuse) — both are concretely exploitable today by
   an authenticated user (in #1's case) or anyone who obtains a password (in #2's case), and both
   have small, contained fixes.
2. Route the Medium findings through the normal spec/build pipeline (`edi-x12-specialist` for
   #3-#4, `builder` + human sign-off for #7-#8 per R-15.9, `florida-rules-engine`/compliance for #5).
3. Add the three human decisions (#5, #8, #13) to `docs/owner/OWNER_ACTION_ITEMS.xlsx` alongside the
   existing open items.
