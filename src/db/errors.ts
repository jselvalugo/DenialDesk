import { DrizzleQueryError } from "drizzle-orm";
import { PgPreparedQuery } from "drizzle-orm/pg-core";
import { LOG_VALUE_PATTERNS, log } from "@/lib/log";

/** A database failure with the query parameters (which can hold PHI) stripped out. */
export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code: string | undefined,
    readonly constraint?: string,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

/** True for a sanitized unique violation (a race callers usually turn into a friendly message). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof DatabaseError && error.code === "23505";
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
// Constraint and index names are schema identifiers; anything else is not trusted into a message.
const IDENTIFIER = LOG_VALUE_PATTERNS.constraint!;

/**
 * SQLSTATEs whose PostgreSQL message names only objects (roles, tables, columns, locks), never
 * values, so it is kept. Every other code gets a generic message (opt-in, not opt-out).
 */
const OBJECT_ONLY_MESSAGE_CODES = new Set([
  "42501", // insufficient_privilege: permission denied / row-level security policy
  "42P01", // undefined_table
  "42703", // undefined_column
  "40001", // serialization_failure
  "40P01", // deadlock_detected
  "25P02", // in_failed_sql_transaction
  "55P03", // lock_not_available
  "57014", // query_canceled (statement timeout)
  "53300", // too_many_connections
]);

/**
 * Every `RAISE EXCEPTION` format string in drizzle/*.sql (SQLSTATE P0001). A trigger message is
 * kept only when it matches one of these, with each `%` filled by a UUID, an integer, or a status
 * word. src/db/errors.test.ts fails if a migration raises a message not listed here or interpolates
 * anything other than IDs, versions, counts, or statuses.
 */
export const TRIGGER_MESSAGE_FORMATS = [
  "audit_events is append-only",
  "claim_versions is append-only",
  "claim_versions.changed_by must be the current user",
  "claims.created_at cannot change",
  "claim % must move to version %",
  "claim % version % has no history row",
  "lines of claim % changed without a new claim version",
  "claim version backfill missed % claims",
  "rcm_voucher_workflow: % -> % is not allowed",
  "rcm_voucher_workflow: approval, export, and void records are write-once",
  "rcm_voucher_workflow: actor is not a member of this practice",
  "rcm_journal_lines_draft_only: lines can only be added to a draft voucher",
  "rcm_deposit_files_uploader: uploader is not a member of this practice",
] as const;

const TRIGGER_ARGUMENT =
  "(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\\d{1,12}|[a-z_]{1,32})";
const TRIGGER_MESSAGES = TRIGGER_MESSAGE_FORMATS.map(
  (format) =>
    new RegExp(
      `^${format
        .split("%")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(TRIGGER_ARGUMENT)}$`,
    ),
);

interface PgErrorFields {
  code?: unknown;
  message?: unknown;
  constraint?: unknown;
}

const isSqlState = (code: unknown): code is string => typeof code === "string" && SQLSTATE.test(code);

/** A node-postgres server error thrown without Drizzle's wrapper (it carries `severity` and a SQLSTATE). */
function isBarePgError(error: unknown): error is Error & PgErrorFields {
  const fields = error as { code?: unknown; severity?: unknown } | null;
  return error instanceof Error && typeof fields?.severity === "string" && isSqlState(fields.code);
}

function safeMessage(code: string | undefined, constraint: string | undefined, message: unknown): string {
  if (!code) return "Database query failed";
  if (code.startsWith("23"))
    return `Integrity constraint violation (SQLSTATE ${code})${constraint ? ` on "${constraint}"` : ""}`;
  if (typeof message === "string") {
    if (OBJECT_ONLY_MESSAGE_CODES.has(code)) return message;
    if (code === "P0001" && TRIGGER_MESSAGES.some((pattern) => pattern.test(message))) return message;
  }
  return `Database query failed (SQLSTATE ${code})`;
}

/**
 * Drizzle puts query parameters in its error message, and PostgreSQL puts row values in `detail`
 * (e.g. `Key (tenant_id, mrn)=(…) already exists`, `Failing row contains (…)`) and sometimes in the
 * message (data exceptions quote the value); Next.js logs unhandled errors. Replace database errors
 * with a fresh DatabaseError that never carries the original error, its `detail`, or its `cause`
 * (CLAUDE.md #4, R-7.4.8):
 * - integrity violations (SQLSTATE class 23): SQLSTATE and constraint name only;
 * - OBJECT_ONLY_MESSAGE_CODES and listed trigger messages: the PostgreSQL message;
 * - every other SQLSTATE (including class 22): SQLSTATE only;
 * - failures with no SQLSTATE (connection loss, driver errors): a generic message.
 * Non-database errors (redirects, notFound, domain errors) pass through untouched.
 */
export function sanitizeDatabaseError(error: unknown): unknown {
  if (error instanceof DatabaseError) return error;
  let pg: PgErrorFields | undefined;
  if (error instanceof DrizzleQueryError) pg = (error.cause ?? {}) as PgErrorFields;
  else if (isBarePgError(error)) pg = error;
  else if (error instanceof Error && isSqlState((error.cause as PgErrorFields | undefined)?.code))
    pg = error.cause as PgErrorFields;
  else return error;

  const code = isSqlState(pg.code) ? pg.code : undefined;
  const constraint =
    typeof pg.constraint === "string" && IDENTIFIER.test(pg.constraint) ? pg.constraint : undefined;
  // Integrity violations are often expected races that callers handle (e.g. a 23505 retry): warn.
  const level = code?.startsWith("23") ? "warn" : "error";
  log[level]("db.query_failed", { status: code ?? "unknown", ...(constraint ? { constraint } : {}) });
  return new DatabaseError(safeMessage(code, constraint, pg.message), code, constraint);
}

type QueryWithCache = (this: unknown, ...args: unknown[]) => Promise<unknown>;
let installed = false;

/**
 * Sanitizes every Drizzle query error where Drizzle creates it: `PgPreparedQuery.queryWithCache`,
 * which every select/insert/update/delete/execute and transaction statement goes through. This
 * covers `systemDb()` (auth, operator, audit, rate-limit) as well as `withTenant`. The method is
 * Drizzle-internal (ADR 0005), so a version that drops it fails at startup, not silently.
 */
export function installQueryErrorSanitizer(): void {
  if (installed) return;
  const prototype = PgPreparedQuery.prototype as unknown as { queryWithCache?: QueryWithCache };
  const original = prototype.queryWithCache;
  if (typeof original !== "function") {
    throw new Error("drizzle-orm no longer has PgPreparedQuery.queryWithCache; update src/db/errors.ts");
  }
  prototype.queryWithCache = async function (this: unknown, ...args: unknown[]) {
    try {
      return await original.apply(this, args);
    } catch (error) {
      throw sanitizeDatabaseError(error);
    }
  };
  installed = true;
}
