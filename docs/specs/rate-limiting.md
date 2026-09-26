# Spec: Rate limiting for public and sign-in endpoints

Status: done (2026-09-26) — requested by the product owner
Roadmap item: Security hardening (REQUIREMENTS §7.4)
Requirement IDs: R-7.4.7, R-7.2.2, R-15.1

## Goal
No single network can hammer the public demo button or try passwords and codes at scale.

## Acceptance criteria
- [x] Fixed-window limits per client network (IP), stored in PostgreSQL so they hold across
      serverless instances:
      - Demo login: 10 per 10 minutes.
      - Password sign-in: 30 attempts per 15 minutes (complements the per-account lockout).
      - MFA codes: 30 attempts per 15 minutes.
      - Preview seed endpoint: 5 per hour.
- [x] Limits are configurable by environment variable for tests; defaults above.
- [x] IPs are stored only as salted hashes (no raw IPs in the limiter table).
- [x] Blocked requests get a clear message and are audited (`security.rate_limited`).
- [x] Old windows are purged automatically.
- [x] Tests: limiter allows up to the limit, blocks the next, resets in a new window, keeps keys
      and buckets separate, and is atomic under concurrent hits.

## Data / API changes
Table `rate_limits(bucket, key_hash, window_start, hits)` — global (not tenant data), no app-role
access. Env: `RATE_LIMIT_DEMO`, `RATE_LIMIT_SIGNIN`, `RATE_LIMIT_MFA` (hits per window).

## Out of scope
Edge/WAF rate limiting (Azure Front Door at cutover, R-7.4.7), per-route limits for signed-in APIs.
