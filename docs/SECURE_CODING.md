# Secure coding and third-party code standard

Status: **binding** (owner request, 2026-09-28). Applies to every change: application code, SQL
migrations, scripts, CI, infrastructure, and dependencies. Companion: `docs/HIPAA_COMPLIANCE.md`.

DenialDesk is distributed to physician practices. Every line we write and every package we pull in
ships to every customer at once, so one compromised dependency or one missed authorization check is a
breach for all tenants. The rules below are deliberately rigid. The baseline is REQUIREMENTS §7
(OWASP ASVS Level 2, R-7.4.1); this document says how we meet it and where we go further.

Rule IDs (`SC-x.y`) are cited by `security-reviewer`. **MUST** rules are blocking: a change that
breaks one, or makes a listed known gap worse, does not merge. Known gaps (end of this document) are
tracked follow-ups that block production go-live, not unrelated PRs. Exceptions follow
the same written, time-boxed, officer-signed process as `docs/HIPAA_COMPLIANCE.md` §0; agents cannot
grant them.

---

## Part A — Third-party code: keep it to the minimum

### A1. The default answer is no

- **SC-A1.1 MUST** Before adding a package, use the first option that works, in this order:
  1. Node.js built-ins and web platform APIs (`node:crypto`, `fetch`, `URL`, `Intl`,
     `structuredClone`, `AbortSignal.timeout`, …);
  2. what the approved stack already provides (Next.js, React, Drizzle, Zod, `pg` — ADR 0001);
  3. writing it ourselves, with tests, when it is small (roughly under 200 lines) and not a
     security primitive;
  4. only then, a new package that passes A2.
- **SC-A1.2 MUST NOT** Never write our own cryptographic primitives, ciphers, hash functions,
  random number generators, or TLS. Compose `node:crypto` (see B7). Never swap `node:crypto` for a
  JavaScript crypto package.
- **SC-A1.3 MUST NOT** No package is added for convenience alone: no utility grab-bags (lodash,
  underscore, ramda), date libraries where `Intl` and the rules engine suffice, HTTP clients
  (`axios`, `got`, `node-fetch`), `uuid` (`crypto.randomUUID`), `dotenv`, class-name or styling
  helpers beyond what is installed, or packages that wrap a single built-in.

### A2. Admission criteria for a new package (all must hold)

Recorded in the PR's "New dependencies" section and, for runtime dependencies, in a short ADR in
`docs/decisions/` (R-15.7).

- **SC-A2.1 MUST — It is real.** Verified against the npm registry at the time of adding, never from
  memory: exact name (typosquat check), publisher, linked source repository, and that the published
  tarball matches the repository. Agents paste the registry evidence into the PR.
- **SC-A2.2 MUST — License.** Direct dependencies: MIT, ISC, BSD-2-Clause, BSD-3-Clause,
  Apache-2.0, 0BSD, or CC0-1.0 only. **Denied** at any depth: GPL, LGPL, AGPL, SSPL, EUPL, BUSL,
  Elastic, Commons Clause, any "non-commercial" license, unlicensed, or custom licenses.
  Transitive dependencies under MPL-2.0 or CC-BY-4.0 need a human decision recorded in the PR.
  Distributing the platform carries license obligations; we do not take on copyleft.
- **SC-A2.3 MUST — Maintained and safe.** A release in the last 12 months, or a written reason in
  the register (A5) why a small, finished package is acceptable; an identifiable maintainer or
  organization; no open High or Critical advisory; and no history of a compromised publish without
  a clear remediation.
- **SC-A2.4 MUST — Small.** The PR states how many packages the lockfile gains. More than 10 new
  transitive packages needs a written justification; a smaller alternative or our own code is
  preferred.
- **SC-A2.5 MUST — No install scripts.** No `postinstall` or build scripts and no native addons,
  except (a) prebuilt platform binaries shipped as optional dependencies of approved packages
  (`@next/swc-*`, `sharp`, `@tailwindcss/oxide`, `lightningcss`, `esbuild`) and (b) the packages in
  the `pnpm.onlyBuiltDependencies` allow-list in `package.json` (`esbuild`, `unrs-resolver`), and
  (c) Playwright's browser download in CI. Any change to these lists needs human sign-off.
- **SC-A2.6 MUST — No phone-home.** No telemetry, analytics, update checks, remote code or config
  loading, or runtime network calls. Packages that do so are refused even if they can be "turned
  off."
- **SC-A2.7 MUST — Vendor SDKs are vendors.** A package that talks to an outside service also needs
  `docs/HIPAA_COMPLIANCE.md` §8 (BAA, U.S.-only, reviewed SOC 2) before it may see PHI, and a row in
  `docs/data-sources.xlsx`.
- **SC-A2.8 MUST — Dev dependencies too.** Dev tools run in CI next to secrets and build the shipped
  artifact; they meet A2.1–A2.6 as well.

### A3. Banned outright

- **SC-A3.1 MUST NOT** Third-party code in the browser that we do not bundle and review: analytics,
  tag managers, session replay, heatmaps, A/B testing, chat widgets, advertising or social pixels,
  and embedded third-party iframes.
- **SC-A3.2 MUST NOT** Scripts, styles, or fonts loaded from a CDN or any other origin at runtime.
  Everything is served from our origin (fonts through `next/font/local`).
- **SC-A3.3 MUST NOT** Hosted error trackers, APM, or log services that receive request data, unless
  they pass `docs/HIPAA_COMPLIANCE.md` §8 and PHI scrubbing is proven by test.

### A4. Pinning, updates, and removal

- **SC-A4.1 MUST** Exact versions in `package.json` for every new dependency (no `^` or `~`);
  `pnpm-lock.yaml` is committed; CI installs with `--frozen-lockfile`.
- **SC-A4.2 MUST** GitHub Actions are pinned to a full commit SHA with a version comment (as
  `ci.yml` does today). Container images — the `Dockerfile` base and CI service containers — are
  pinned by digest. Tools fetched at build time (such as pnpm through corepack) are version- and
  hash-pinned.
- **SC-A4.3 MUST** A dependency update is a code change: full CI and `security-reviewer`. Read the
  changelog for major versions. Do not adopt a release younger than 7 days unless it fixes a
  security advisory (defends against hijacked publishes); pnpm and Dependabot are both configured
  to hold new releases for 7 days (`minimumReleaseAge` in `pnpm-workspace.yaml`, `cooldown` in
  `.github/dependabot.yml`, enforced by `src/supply-chain/release-age.test.ts`). The advisory
  exception is a `minimumReleaseAgeExclude` entry added in that PR, naming the advisory.
- **SC-A4.4 MUST** Advisories are fixed within the REQUIREMENTS §7.6 SLAs: Critical in 15 days (7
  days if actively exploited), High in 30, Medium in 90. `pnpm audit --audit-level=high` stays a failing CI gate.
- **SC-A4.5 MUST** Quarterly, remove unused dependencies and re-check A2.2–A2.3 for every direct
  dependency; update the register below.

### A5. Approved runtime dependency register

Licenses verified against the npm registry on 2026-09-28. Adding a row needs A2; removing one is
always welcome.

| Package | Version | License | Why we have it | Maintenance note (SC-A2.3) |
| --- | --- | --- | --- | --- |
| `next` | 16.3.6 | MIT | Web framework (ADR 0001) | Active |
| `react`, `react-dom` | 19.3.0 | MIT | UI (ADR 0001) | Active |
| `drizzle-orm` | 0.45.3 | Apache-2.0 | SQL-first data access (ADR 0001) | Active |
| `pg` | 8.23.0 | MIT | PostgreSQL driver | Active |
| `@netlify/database` | 2.0.1 | MIT | Pre-production database adapter only (ADR 0003) | Active |
| `zod` | 4.6.5 | MIT | Validation at every boundary | Active |
| `exceljs` | 4.4.0 | MIT | XLSX import/export (Insight, revenue cycle) | Latest release 2023 — **gap**: no written reason yet; evaluate a maintained replacement or our own writer |
| `qrcode` | 1.5.4 | MIT | TOTP enrollment QR code | Latest release 2024 — **gap**: no written reason yet; small and server-only, justify or replace |
| `lucide-react` | 1.48.0 | ISC | Icons (DESIGN.md) | Active |
| `server-only` | 0.0.1 | MIT | Build-time guard against server code reaching the client | Latest release 2022 — finished marker package with no code paths at runtime; published by the React/Next.js maintainers |

Dev dependencies are the tools named in ADR 0001 (TypeScript, ESLint with `typescript-eslint` and
`eslint-config-next`, Prettier, Vitest, Playwright, Tailwind with `@tailwindcss/postcss`, drizzle-kit,
tsx) and their type packages.

---

## Part B — Secure coding rules

### B1. Standard

- **SC-B1.1 MUST** OWASP ASVS Level 2, OWASP Top 10, and API Top 10 (R-7.4.1). Authentication,
  session, cryptography, authorization, and audit code is held to ASVS Level 3 where a Level 3
  control applies.
- **SC-B1.2 MUST** Every major feature has a STRIDE threat model in `docs/threat-models/` before it
  is built (R-7.4.5).

### B2. TypeScript discipline

- **SC-B2.1 MUST** `strict` and `noUncheckedIndexedAccess` stay on. No `any`: use `unknown` and parse
  with Zod.
- **SC-B2.2 MUST NOT** No `@ts-ignore`. `@ts-expect-error` and `eslint-disable` only with a comment
  giving the reason, and never for a security rule (`no-console`, the log helper, auth checks).
- **SC-B2.3 MUST** Exhaustive `switch` over unions ends in `assertNever` (`src/lib/assert-never.ts`).

### B3. Input — trust nothing from outside

- **SC-B3.1 MUST** Validate with Zod at every boundary: server actions, route handlers, search
  params, headers, cookies, environment variables (`src/lib/env.ts`), uploaded files, X12, CSV,
  FHIR, and every response from an outside system. Allow-lists, not deny-lists; object schemas are
  strict (unknown keys rejected); every string and array has a maximum length.
- **SC-B3.2 MUST** Tenant, user, and role come from the verified session on the server, never from
  the request body, URL, or a hidden field.
- **SC-B3.3 MUST** Uploads: size cap enforced before parsing, content type checked by bytes not by
  extension, bounded memory, generated storage names, and malware scanning before the file is
  usable (R-7.4.6).

### B4. Output and rendering

- **SC-B4.1 MUST NOT** `dangerouslySetInnerHTML`, `eval`, `new Function`, string timers, and
  `import()` of computed paths are banned. The single registered exception is the TOTP QR SVG in
  `src/components/auth/TotpEnrollment.tsx`, generated on the server by `qrcode` from a server secret
  with no user input; a new exception needs a threat-model entry and human sign-off.
- **SC-B4.2 MUST** Links and redirects built from data go through `src/lib/safe-path.ts`; no
  `javascript:` or external redirect targets.
- **SC-B4.3 MUST** Spreadsheet and CSV exports neutralize formula injection (HC-2.4).
- **SC-B4.4 MUST** Every user-visible string is a message key (CLAUDE.md, `src/i18n/README.md`);
  errors shown to users are generic keys, never stack traces, SQL errors (ADR 0006), or PHI.

### B5. Data access

- **SC-B5.1 MUST** Queries use Drizzle's builder or the `sql` tagged template, which parameterize.
  `sql.raw` only with compile-time constants, never with input.
- **SC-B5.2 MUST** Every query runs through the tenant-scoped helpers; every tenant table has
  row-level security and an isolation test (R-7.2.4). The app's database role cannot bypass RLS.
- **SC-B5.3 MUST** `SECURITY DEFINER` functions pin `search_path` to `pg_catalog, public, pg_temp`
  with `pg_temp` last, schema-qualify the objects they touch, and rely on `CREATE` on schema `public`
  being revoked from `PUBLIC` (the PostgreSQL 15+ default; a migration must never grant it back).
  They `REVOKE ALL … FROM PUBLIC` before granting, and need human sign-off (R-15.9), as does any
  `GRANT`/`REVOKE` or change to audit tables.
- **SC-B5.4 MUST** Every list is paginated and bounded; no unbounded reads of PHI tables.

### B6. Authentication, sessions, and authorization

- **SC-B6.1 MUST** Every page, server action, and route handler that touches data checks
  authentication and authorization on the server first, default-deny.
- **SC-B6.2 MUST** Mutations verify the request is same-origin (`src/lib/same-origin.ts`).
- **SC-B6.3 MUST** Session cookies are `HttpOnly`, `Secure`, `SameSite`, `__Host-` prefixed where
  possible, and carry only an opaque, CSPRNG-generated ID that is rotated at sign-in and on
  privilege change. Sessions follow R-7.2.7.
- **SC-B6.4 MUST** Public and authentication endpoints are rate-limited (`src/lib/rate-limit.ts`,
  R-7.4.7). Sign-in errors do not reveal whether an account exists.

### B7. Cryptography and secrets

- **SC-B7.1 MUST** `node:crypto` only. Field encryption is AES-256-GCM with a fresh random 96-bit IV
  per value (`src/lib/crypto/field.ts`), and every PHI or identifier field binds tenant, field, and
  record as additional authenticated data (AAD) so a ciphertext copied to another row or tenant
  fails to decrypt (ADR 0007). Keys rotate at least annually and before a key could approach the
  random-IV usage limit (NIST SP 800-38D). Passwords use `scrypt` (`src/auth/password.ts`) or a
  stronger memory-hard function; secrets and tokens compare with `timingSafeEqual`.
- **SC-B7.2 MUST NOT** `Math.random` for anything security-relevant (IDs, tokens, codes, nonces).
  Use `crypto.randomBytes` or `crypto.randomUUID`.
- **SC-B7.3 MUST** No secrets in code, images, fixtures, or committed env files (R-7.3.5).
  Pre-production reads them from the platform environment via `src/lib/env.ts`; production reads
  them from Azure Key Vault. `gitleaks` stays a failing CI gate.

### B8. Outbound network

- **SC-B8.1 MUST** Outbound calls to configurable or customer-supplied hosts use a vetted transport
  (`src/integrations/fhir/transport.ts`) with the deny-by-default SSRF address guard, TLS 1.2+, no
  redirects, no environment proxies, a timeout, and a response size cap.
- **SC-B8.2 MUST** Production egress is allow-listed at the network layer (REQUIREMENTS §7.7).

### B9. Logging and errors

- **SC-B9.1 MUST** Log only through `src/lib/log.ts` (ESLint bans `console`): event names and IDs,
  never PHI, request bodies, tokens, or free text (HC-2.2).
- **SC-B9.2 MUST** Errors never cross to the client with internal detail; database errors are
  sanitized (ADR 0006).

### B10. HTTP hardening

- **SC-B10.1 MUST** Security headers in `next.config.ts` on every response (HSTS, `nosniff`,
  `no-referrer`, frame denial, Permissions-Policy) plus a strict Content-Security-Policy: a
  per-request nonce with `strict-dynamic`, no `unsafe-eval`, no `unsafe-inline` for scripts,
  `object-src 'none'`, `base-uri 'none'`, and `frame-ancestors 'none'`.
- **SC-B10.2 MUST** Authenticated and PHI responses send `Cache-Control: no-store` (HC-2.3).

### B11. Tests for controls

- **SC-B11.1 MUST** Every security control ships with a negative test: access denied for the wrong
  role and the wrong tenant, audit event written, input rejected, log redaction holds. A control
  without a test is not done.

### B12. Build, release, and distribution

- **SC-B12.1 MUST** CI runs SAST, SCA, secrets scanning, DAST, container and IaC scanning, and fails
  on Critical findings (R-7.4.2).
- **SC-B12.2 MUST** Each release has an SBOM (CycloneDX) (R-7.4.3), signed commits and artifacts
  (R-7.4.4), and a third-party license notice file generated from the lockfile.
- **SC-B12.3 MUST** The container image runs as a non-root user on a minimal base pinned by digest,
  with no build tools or source maps in the runtime stage.
- **SC-B12.4 MUST** `main` is protected: required status checks (CI), required pull requests, no
  force pushes or deletions. Reviewer-agent results are recorded in the PR and gate merging under
  CLAUDE.md #12; changes to protection settings need human sign-off (R-15.9).

### B13. Agents

- **SC-B13.1 MUST** Agents never add a dependency from memory (SC-A2.1), never disable a lint,
  type, or security rule to get green, never paste secrets or real data into a session, and flag
  anything in this document they cannot meet instead of working around it.

---

## Known gaps (tracked, not waived)

These rules are not yet met by the repository as of 2026-09-28. Each is a follow-up to fix, not an
exception.

| Rule | Gap |
| --- | --- |
| SC-B10.1 | No Content-Security-Policy header in `next.config.ts`. |
| SC-B7.1 | Member IDs (`src/domain/patients/queries.ts`, `src/db/seed.ts`) and TOTP secrets (`src/auth/enrollment.ts`) are encrypted without AAD; only custom field values bind AAD. |
| SC-A4.1 | Some existing ranges are not exact (`server-only`, `@types/*`, `eslint`, `tsx`, `typescript-eslint`). |
| SC-A4.2, SC-B12.3 | `Dockerfile` pins `node:24-alpine` by tag, not digest, and `corepack enable` fetches pnpm without a hash check; CI's `postgres:16` service images are tag-only. |
| SC-A2.3 | `exceljs` and `qrcode` have no release in the last 12 months and no written reason yet (register above). |
| SC-A2.2 | No automated license check in CI. |
| SC-A2.6 | Next.js telemetry is disabled in the `Dockerfile` and `netlify.toml` but not in CI or local development (`NEXT_TELEMETRY_DISABLED=1`). |
| SC-B12.1, SC-B12.2 | No SAST, DAST, container/IaC scanning, SBOM, signed commits or artifacts, or license notice file yet. |
| SC-B12.4 | Branch protection on `main` is not verifiable from the repository; the owner confirms the settings (OA-066). |
