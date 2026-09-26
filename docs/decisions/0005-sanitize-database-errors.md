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
  through which every select/insert/update/delete/execute and transaction statement runs, so every
  query error becomes a `DatabaseError` at the source. `systemDb()` installs it before the first
  query; `withTenant` still sanitizes as a second line.
- A `DatabaseError` never carries the original error, `detail`, or `cause`. It keeps the SQLSTATE,
  a validated constraint name, and a message that is either known to be value-free or generic:
  - class 23: `Integrity constraint violation (SQLSTATE x) on "<constraint>"`;
  - an allow-list of object-only codes (42501, 42P01, 42703, 40001, 40P01, 25P02, 55P03, 57014,
    53300): the PostgreSQL message;
  - P0001: the trigger message only if it matches a format in `TRIGGER_MESSAGE_FORMATS`, with each
    `%` a UUID, integer, or status word;
  - everything else: `Database query failed (SQLSTATE x)`.
- Callers match on `.code` / `.constraint` (`isUniqueViolation`), never on message text.

## Consequences
- `queryWithCache` is Drizzle-internal. drizzle-orm is pinned; if an upgrade drops the method,
  `installQueryErrorSanitizer` throws at startup, and `src/db/errors.test.ts` fails in CI.
- A new trigger `RAISE` must be added to `TRIGGER_MESSAGE_FORMATS`; a unit test scans
  `drizzle/*.sql` and fails on an unlisted format, a non-ID/version/status argument, or a
  `USING` clause.
- Errors are less descriptive in logs; the SQLSTATE, constraint, and `request.unhandled_error`
  digest are the debugging handles.
