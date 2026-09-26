import { DrizzleQueryError } from "drizzle-orm";
import { PgPreparedQuery } from "drizzle-orm/pg-core";
import { LOG_VALUE_PATTERNS, log } from "@/lib/log";
import { voucherStatusEnum } from "./schema";

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

/**
 * True for a sanitized database error. Checked by name, not `instanceof`, so it holds even if this
 * module is loaded twice (dev HMR, separate server bundles) while Drizzle's prototype is shared.
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof Error && error.name === "DatabaseError";
}

/** True for a sanitized unique violation (a race callers usually turn into a friendly message). */
export function isUniqueViolation(error: unknown): boolean {
  return isDatabaseError(error) && error.code === "23505";
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

/** What a trigger may interpolate into a `%`: an ID, a small integer, or a voucher status. */
export type TriggerSlot = "uuid" | "int" | "voucherStatus";
const SLOT_PATTERNS: Record<TriggerSlot, string> = {
  uuid: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
  // Versions and counts; at most 6 digits so an SSN, member ID, or numeric MRN never matches.
  int: "\\d{1,6}",
  voucherStatus: `(?:${voucherStatusEnum.enumValues.join("|")})`,
};

/**
 * Every `RAISE` format string in drizzle/*.sql (SQLSTATE P0001), with the type of each `%`. A
 * trigger message is kept only when it matches one of these exactly. src/db/errors.test.ts fails if
 * a migration raises a format not listed here, or interpolates an expression whose type differs.
 */
export const TRIGGER_MESSAGES: readonly { format: string; args: readonly TriggerSlot[] }[] = [
  { format: "audit_events is append-only", args: [] },
  { format: "claim_versions is append-only", args: [] },
  { format: "claim_versions.changed_by must be the current user", args: [] },
  { format: "claims.created_at cannot change", args: [] },
  { format: "claim % must move to version %", args: ["uuid", "int"] },
  { format: "claim % version % has no history row", args: ["uuid", "int"] },
  { format: "lines of claim % changed without a new claim version", args: ["uuid"] },
  { format: "claim version backfill missed % claims", args: ["int"] },
  { format: "rcm_voucher_workflow: % -> % is not allowed", args: ["voucherStatus", "voucherStatus"] },
  { format: "rcm_voucher_workflow: approval, export, and void records are write-once", args: [] },
  { format: "rcm_voucher_workflow: actor is not a member of this practice", args: [] },
  { format: "rcm_journal_lines_draft_only: lines can only be added to a draft voucher", args: [] },
  { format: "rcm_deposit_files_uploader: uploader is not a member of this practice", args: [] },
  { format: "tenant_agreements rows are retained, never deleted", args: [] },
  { format: "a voided agreement cannot change", args: [] },
  { format: "tenant_agreements recorded fields are immutable", args: [] },
  { format: "custom_fields identity is immutable", args: [] },
  { format: "custom_field_values: field does not belong to this tenant", args: [] },
  { format: "custom_field_values: field is not a patient field", args: [] },
  { format: "custom_field_values: field is not a claim field", args: [] },
  { format: "custom_field_values: field is not a denial field", args: [] },
  { format: "custom_field_values: field is not a payer field", args: [] },
  { format: "custom_field_values: record does not belong to this tenant", args: [] },
  { format: "custom_field_values identity is immutable", args: [] },
  { format: "custom_field_value_versions is append-only", args: [] },
  { format: "voiding may only set the void fields", args: [] },
  { format: "void fields belong to voided agreements only", args: [] },
  { format: "tenant_agreements status may only move to superseded or voided", args: [] },
];

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TRIGGER_PATTERNS = TRIGGER_MESSAGES.map(({ format, args }) => {
  const parts = format.split("%");
  if (parts.length - 1 !== args.length) throw new Error(`Trigger format slots don't match: ${format}`);
  return new RegExp(
    `^${parts.map((part, k) => escapeRegExp(part) + (k < args.length ? SLOT_PATTERNS[args[k]!] : "")).join("")}$`,
  );
});

interface PgErrorFields {
  code?: unknown;
  message?: unknown;
  constraint?: unknown;
}

const isSqlState = (code: unknown): code is string => typeof code === "string" && SQLSTATE.test(code);

/**
 * PostgreSQL server errors carry `severity`; Node socket errors (EPIPE, EPERM) have no severity
 * and a code that merely looks like a SQLSTATE, so they are not trusted as one.
 */
function serverFields(cause: unknown): PgErrorFields | undefined {
  const fields = cause as (PgErrorFields & { severity?: unknown }) | null | undefined;
  return typeof fields?.severity === "string" && isSqlState(fields.code) ? fields : undefined;
}

/** The SQLSTATE of a PostgreSQL server error (bare or wrapped), for logging. */
export function sqlStateOf(error: unknown): string | undefined {
  const fields = serverFields(error) ?? serverFields((error as { cause?: unknown } | null)?.cause);
  return fields?.code as string | undefined;
}

/** A node-postgres server error thrown without Drizzle's wrapper (it carries `severity` and a SQLSTATE). */
function isBarePgError(error: unknown): error is Error & PgErrorFields {
  return error instanceof Error && serverFields(error) !== undefined;
}

function safeMessage(code: string | undefined, constraint: string | undefined, message: unknown): string {
  if (!code) return "Database query failed";
  if (code.startsWith("23"))
    return `Integrity constraint violation (SQLSTATE ${code})${constraint ? ` on "${constraint}"` : ""}`;
  if (typeof message === "string") {
    if (OBJECT_ONLY_MESSAGE_CODES.has(code)) return message;
    if (code === "P0001" && TRIGGER_PATTERNS.some((pattern) => pattern.test(message))) return message;
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
  if (isDatabaseError(error)) return error;
  let pg: PgErrorFields | undefined;
  if (error instanceof DrizzleQueryError) pg = serverFields(error.cause) ?? {};
  else if (isBarePgError(error)) pg = error;
  else if (error instanceof Error && serverFields(error.cause)) pg = serverFields(error.cause);
  else return error;

  const code = isSqlState(pg!.code) ? pg!.code : undefined;
  const constraint =
    typeof pg!.constraint === "string" && IDENTIFIER.test(pg!.constraint) ? pg!.constraint : undefined;
  // Integrity violations are often expected races that callers handle (e.g. a 23505 retry): warn.
  const level = code?.startsWith("23") ? "warn" : "error";
  log[level]("db.query_failed", { status: code ?? "unknown", ...(constraint ? { constraint } : {}) });
  return new DatabaseError(safeMessage(code, constraint, pg!.message), code, constraint);
}

/**
 * Checking out a pool connection happens outside Drizzle's query path (e.g. at the start of
 * `systemDb().transaction`). Its errors name hosts, roles, or databases, so they are replaced too.
 */
export function sanitizeConnectionError(error: unknown): DatabaseError {
  const sanitized = sanitizeDatabaseError(error);
  if (isDatabaseError(sanitized)) return sanitized;
  log.error("db.connection_failed", { status: "unknown" });
  return new DatabaseError("Database connection failed", undefined);
}

type QueryWithCache = (this: unknown, ...args: unknown[]) => Promise<unknown>;
// On the shared Drizzle prototype, not in this module, so a second copy of this module never wraps twice.
const SANITIZED = Symbol.for("denialdesk.queryErrorSanitizer");

/**
 * Sanitizes every Drizzle query error where Drizzle creates it: `PgPreparedQuery.queryWithCache`,
 * which every select/insert/update/delete/execute, relational query, and transaction or savepoint
 * statement goes through. This covers `systemDb()` (auth, operator, audit, rate-limit) as well as
 * `withTenant`. The method is Drizzle-internal (ADR 0006): `register()` installs this at server
 * start, so a Drizzle version without it fails to boot rather than silently leaking.
 */
export function installQueryErrorSanitizer(): void {
  const prototype = PgPreparedQuery.prototype as unknown as {
    queryWithCache?: QueryWithCache;
    [SANITIZED]?: true;
  };
  if (prototype[SANITIZED]) return;
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
  prototype[SANITIZED] = true;
}
