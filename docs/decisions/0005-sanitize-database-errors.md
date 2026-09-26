# ADR 0005: Sanitize every database error where Drizzle creates it

Status: accepted (2026-09-26)

## Context
Next.js logs unhandled server errors to the host's function logs. Drizzle's `DrizzleQueryError`
message contains the query parameters, and PostgreSQL errors carry row values in `detail`
(`Key (tenant_id, mrn)=(…)`, `Failing row contains (…)`) and sometimes in the message (data
exceptions, trigger `RAISE` text). Sanitizing only in `withTenant` left ~40 direct `systemDb()`
call sites (auth, operator console, practices, audit, rate-limit) able to log staff emails, names,
and password hashes (PR #28 reviews). CLAUDE.md #4, R-7.4.8.

## Decision
- `src/db/errors.ts` wraps Drizzle's `PgPreparedQuery.prototype.queryWithCache`, the one method
  through which every select/insert/update/delete/execute, relational query, and transaction or
  savepoint statement (including `commit`) runs, so every query error becomes a `DatabaseError` at
  the source. `register()` (src/instrumentation.ts) and `systemDb()` install it; `withTenant` still
  sanitizes as a second line.
- Checking out a pool connection (`transaction` start) happens outside that method: `systemDb()`'s
  pool replaces those errors (they name hosts, roles, databases) with `Database connection failed`
  or a sanitized SQLSTATE, and logs idle-client pool errors by SQLSTATE only.
- A `DatabaseError` never carries the original error, `detail`, or `cause`. It keeps a SQLSTATE
  (only from errors with a Postgres `severity`, so Node's EPIPE is not mistaken for one), a
  validated constraint name, and a message that is either known to be value-free or generic:
  - class 23: `Integrity constraint violation (SQLSTATE x) on "<constraint>"`;
  - an allow-list of object-only codes (42501, 42P01, 42703, 40001, 40P01, 25P02, 55P03, 57014,
    53300): the PostgreSQL message;
  - P0001: the trigger message only if it matches an entry in `TRIGGER_MESSAGES`, each `%` bound
    to its type (UUID, integer of at most 6 digits, or `rcm_voucher_status` value);
  - everything else: `Database query failed (SQLSTATE x)`.
- Callers match on `.code` / `.constraint` (`isUniqueViolation`, by error name, not `instanceof`),
  never on message text.

## Consequences
- `queryWithCache` is Drizzle-internal. drizzle-orm is pinned; if an upgrade drops the method, the
  server fails to boot and `src/db/errors.test.ts` fails in CI. An upgrade could also add a path
  that bypasses it, so **any drizzle-orm or pg version bump needs a security-reviewer pass**, and
  the integration tests (test/integration/tenancy.test.ts) that push select, relational, execute,
  transaction, savepoint, and commit-time errors through a real database must stay green. The
  unit test uses a bare prototype; those integration tests are what prove Drizzle's real
  node-postgres query class still reaches the wrapper.
- A new trigger `RAISE` must be added to `TRIGGER_MESSAGES`; a unit test scans `drizzle/*.sql`
  and fails on any RAISE it can't parse strictly (`E''`, `''`, `USING`), an unlisted format, or an
  argument whose type doesn't match its slot.
- Not covered: `drizzle-kit migrate` output and OpenTelemetry spans (Azure deploy gate,
  docs/PROJECT_STATE.md).
- Errors are less descriptive in logs; the SQLSTATE, constraint, and `request.unhandled_error`
  digest are the debugging handles.
