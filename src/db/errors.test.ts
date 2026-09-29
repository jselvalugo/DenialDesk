import { readdirSync, readFileSync } from "node:fs";
import { DrizzleQueryError } from "drizzle-orm";
import { PgPreparedQuery } from "drizzle-orm/pg-core";
import { DatabaseError as PgDatabaseError } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DatabaseError,
  installQueryErrorSanitizer,
  sanitizeConnectionError,
  isUniqueViolation,
  sanitizeDatabaseError,
  TRIGGER_MESSAGES,
  type TriggerSlot,
} from "./errors";

// Synthetic values only (CLAUDE.md #1). Each one must never survive sanitizing.
const NAME = "Synthia Testpatient";
const MRN = "SYN-MRN-000123";
const TENANT = "00000000-0000-4000-8000-000000000001";

function pgError(fields: Partial<PgDatabaseError> & { message: string }): PgDatabaseError {
  const error = new PgDatabaseError(fields.message, fields.message.length, "error");
  Object.assign(error, { severity: "ERROR", ...fields });
  return error;
}

function drizzleError(cause: unknown): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "patients" ("tenant_id", "mrn", "name") values ($1, $2, $3)',
    [TENANT, MRN, NAME],
    cause as Error,
  );
}

/** Everything a logger or error tracker could serialize from the sanitized error. */
function surface(error: unknown): string {
  const e = error as Error;
  return [
    e.message,
    e.stack,
    JSON.stringify(e),
    JSON.stringify(Object.getOwnPropertyDescriptors(e)),
    String(e.cause),
  ].join("\n");
}

let stderr: string[];
beforeEach(() => {
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => vi.restoreAllMocks());

const uniqueViolation = () =>
  pgError({
    message: 'duplicate key value violates unique constraint "patients_tenant_mrn_unique"',
    code: "23505",
    constraint: "patients_tenant_mrn_unique",
    table: "patients",
    detail: `Key (tenant_id, mrn)=(${TENANT}, ${MRN}) already exists.`,
  });

const checkViolation = () =>
  pgError({
    // A trigger or custom RAISE can put values in the message itself, not just in detail.
    message: `new row for relation "patients" violates check constraint "patients_name_nonblank": ${NAME}`,
    code: "23514",
    constraint: "patients_name_nonblank",
    detail: `Failing row contains (${TENANT}, ${MRN}, ${NAME}).`,
  });

describe("sanitizeDatabaseError: integrity violations (class 23)", () => {
  it.each([
    ["23505 unique", uniqueViolation, "patients_tenant_mrn_unique"],
    ["23514 check", checkViolation, "patients_name_nonblank"],
  ])("keeps only SQLSTATE and constraint for a Drizzle-wrapped %s violation", (_, make, constraint) => {
    const sanitized = sanitizeDatabaseError(drizzleError(make())) as DatabaseError;
    expect(sanitized).toBeInstanceOf(DatabaseError);
    expect(sanitized.code).toBe(make().code);
    expect(sanitized.constraint).toBe(constraint);
    expect(sanitized.cause).toBeUndefined();
    expect(Object.keys(sanitized).sort()).toEqual(["code", "constraint", "name"]);
    expect(sanitized.message).toBe(
      `Integrity constraint violation (SQLSTATE ${make().code}) on "${constraint}"`,
    );
    for (const value of [NAME, MRN, TENANT, "Key (", "Failing row"]) {
      expect(surface(sanitized)).not.toContain(value);
      expect(stderr.join("")).not.toContain(value);
    }
  });

  it("sanitizes a bare node-postgres error (no Drizzle wrapper) the same way", () => {
    const sanitized = sanitizeDatabaseError(checkViolation()) as DatabaseError;
    expect(sanitized).toBeInstanceOf(DatabaseError);
    expect(sanitized.code).toBe("23514");
    expect(surface(sanitized)).not.toContain(NAME);
  });

  it("drops a constraint name that isn't a plain identifier", () => {
    const error = uniqueViolation();
    error.constraint = `idx (${NAME})`;
    const sanitized = sanitizeDatabaseError(drizzleError(error)) as DatabaseError;
    expect(sanitized.constraint).toBeUndefined();
    expect(sanitized.message).toBe("Integrity constraint violation (SQLSTATE 23505)");
  });

  it('keeps callers\' `.code === "23505"` checks working', () => {
    const sanitized = sanitizeDatabaseError(drizzleError(uniqueViolation()));
    expect((sanitized as { code?: string }).code === "23505").toBe(true);
    expect(isUniqueViolation(sanitized)).toBe(true);
    expect(isUniqueViolation(sanitizeDatabaseError(drizzleError(checkViolation())))).toBe(false);
  });

  it("logs only status and constraint, at warn (callers often handle these races)", () => {
    sanitizeDatabaseError(drizzleError(uniqueViolation()));
    const record = JSON.parse(stderr.join("")) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(["constraint", "event", "level", "status", "ts"]);
    expect(record).toMatchObject({ event: "db.query_failed", level: "warn", status: "23505" });
  });
});

describe("sanitizeDatabaseError: other errors", () => {
  it("keeps only the code for data exceptions (class 22), which quote the value", () => {
    const error = pgError({ message: `invalid input syntax for type date: "${NAME}"`, code: "22007" });
    const sanitized = sanitizeDatabaseError(drizzleError(error)) as DatabaseError;
    expect(sanitized.code).toBe("22007");
    expect(sanitized.message).toBe("Database query failed (SQLSTATE 22007)");
    expect(sanitized.cause).toBeUndefined();
    expect(surface(sanitized)).not.toContain(NAME);
    expect(stderr.join("")).not.toContain(NAME);
  });

  it("keeps the PostgreSQL message (never detail or params) for other SQLSTATEs", () => {
    const error = pgError({
      message: 'new row violates row-level security policy for table "patients"',
      code: "42501",
      detail: `Failing row contains (${NAME}).`,
    });
    const sanitized = sanitizeDatabaseError(drizzleError(error)) as DatabaseError;
    expect(sanitized.message).toBe(error.message);
    expect(surface(sanitized)).not.toContain(NAME);
    expect(surface(sanitized)).not.toContain(MRN);
  });

  it("uses a generic message when Drizzle wraps a non-database failure", () => {
    const sanitized = sanitizeDatabaseError(drizzleError(new Error(`bad value ${NAME}`))) as DatabaseError;
    expect(sanitized).toBeInstanceOf(DatabaseError);
    expect(sanitized.code).toBeUndefined();
    expect(sanitized.message).toBe("Database query failed");
    expect(surface(sanitized)).not.toContain(NAME);
    expect(surface(sanitized)).not.toContain(MRN);
  });

  it("passes through a non-database error whose cause has a non-SQLSTATE code", () => {
    const error = new Error("fetch failed", {
      cause: Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
    });
    expect(sanitizeDatabaseError(error)).toBe(error);
  });

  it("passes non-database errors through and does not re-wrap a sanitized one", () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/claims;307;",
    });
    expect(sanitizeDatabaseError(redirect)).toBe(redirect);
    const sanitized = sanitizeDatabaseError(drizzleError(uniqueViolation()));
    expect(sanitizeDatabaseError(sanitized)).toBe(sanitized);
  });
});

describe("sanitizeDatabaseError: messages are kept only when known to be value-free", () => {
  const sanitize = (fields: { message: string; code: string }) =>
    sanitizeDatabaseError(drizzleError(pgError(fields))) as DatabaseError;

  it("keeps object-only messages (permissions, row-level security)", () => {
    const message = 'permission denied for table "audit_events"';
    expect(sanitize({ message, code: "42501" }).message).toBe(message);
  });

  it("drops the message for any SQLSTATE not on the allow-list", () => {
    for (const code of ["XX000", "P0004", "0A000", "42883"]) {
      const sanitized = sanitize({ message: `something about ${NAME}`, code });
      expect(sanitized.message).toBe(`Database query failed (SQLSTATE ${code})`);
      expect(surface(sanitized)).not.toContain(NAME);
    }
  });

  it("keeps a trigger message that matches a listed format with ID, number, or status arguments", () => {
    for (const message of [
      "claim 3f2a0c1e-8d4b-4c6a-9e7f-0a1b2c3d4e5f must move to version 4",
      "rcm_voucher_workflow: approved -> draft is not allowed",
      "audit_events is append-only",
    ]) {
      expect(sanitize({ message, code: "P0001" }).message).toBe(message);
    }
  });

  it("drops a trigger message that isn't listed or whose argument isn't an ID, number, or status", () => {
    for (const message of [
      `claim ${NAME} must move to version 4`,
      `rcm_voucher_workflow: ${MRN} -> draft is not allowed`,
      `patient ${NAME} already has a claim`,
      // PHI-shaped values in typed slots: a 9-digit SSN/member ID, a lowercase name, a non-status word.
      "claim 3f2a0c1e-8d4b-4c6a-9e7f-0a1b2c3d4e5f must move to version 123456789",
      "claim testpatient version 2 has no history row",
      "rcm_voucher_workflow: synthia -> draft is not allowed",
    ]) {
      const sanitized = sanitize({ message, code: "P0001" });
      expect(sanitized.message).toBe("Database query failed (SQLSTATE P0001)");
      expect(surface(sanitized)).not.toContain(NAME);
      expect(surface(sanitized)).not.toContain(MRN);
    }
  });
});

describe("migrations raise only listed, value-free trigger messages", () => {
  const dir = new URL("../../drizzle/", import.meta.url);
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => ({ file, sql: readFileSync(new URL(file, dir), "utf8") }));
  // Any RAISE that can abort (level omitted defaults to EXCEPTION), vs. the strict form we parse.
  const ANY_RAISE = /\bRAISE\b(?!\s+(?:NOTICE|WARNING|INFO|LOG|DEBUG)\b)/gi;
  const STRICT_RAISE = /\bRAISE\s+(?:EXCEPTION\s+)?'([^']*)'\s*(?:,([^;]*))?;/gi;
  const raises = sources.flatMap(({ file, sql }) =>
    [...sql.matchAll(STRICT_RAISE)].map((match) => ({
      file,
      format: match[1]!,
      args: (match[2] ?? "")
        .split(",")
        .map((arg) => arg.trim())
        .filter(Boolean),
    })),
  );
  // Each interpolated expression's type; anything not listed fails the test.
  const EXPRESSION_SLOTS: Record<string, TriggerSlot> = {
    "OLD.id": "uuid",
    "NEW.id": "uuid",
    "NEW.claim_id": "uuid",
    "NEW.denial_id": "uuid",
    "NEW.remittance_id": "uuid",
    "NEW.version": "int",
    "OLD.version + 1": "int",
    missing: "int",
    "OLD.status": "voucherStatus",
    "NEW.status": "voucherStatus",
    p_connection_id: "uuid",
  };
  // "OLD.status"/"NEW.status" name a different enum in this migration's own trigger.
  const FILE_EXPRESSION_SLOTS: Record<string, Record<string, TriggerSlot>> = {
    "0029_appeals.sql": { "OLD.status": "appealStatus", "NEW.status": "appealStatus" },
    "0039_patient_integrations_data_layer.sql": {
      "OLD.status": "integrationConnectionStatus",
      "NEW.status": "integrationConnectionStatus",
      old_run_status: "integrationSyncRunStatus",
      new_run_status: "integrationSyncRunStatus",
    },
    "0040_patient_integrations_review_polish.sql": {
      "OLD.status": "integrationConnectionStatus",
      "NEW.status": "integrationConnectionStatus",
    },
    "0042_submit_requires_fresh_attestation.sql": {
      "OLD.status": "integrationConnectionStatus",
      "NEW.status": "integrationConnectionStatus",
    },
    "0043_patient_integrations_sync_engine.sql": {
      "OLD.status": "integrationConnectionStatus",
      "NEW.status": "integrationConnectionStatus",
    },
  };

  it("parses every RAISE strictly (no E'', quoted '' or USING forms slip past the checks)", () => {
    for (const { file, sql } of sources) {
      const all = [...sql.matchAll(ANY_RAISE)].length;
      const parsed = [...sql.matchAll(STRICT_RAISE)].length;
      expect({ file, parsed }).toEqual({ file, parsed: all });
    }
    expect(raises.length).toBeGreaterThanOrEqual(TRIGGER_MESSAGES.length);
  });

  it.each(raises.map((raise) => [raise.file, raise.format, raise] as const))(
    "%s: '%s' is listed, and each argument has its slot's type",
    (_, format, raise) => {
      const listed = TRIGGER_MESSAGES.find((entry) => entry.format === format);
      expect(listed, `add "${format}" to TRIGGER_MESSAGES`).toBeDefined();
      const slots = { ...EXPRESSION_SLOTS, ...FILE_EXPRESSION_SLOTS[raise.file] };
      expect(raise.args.map((arg) => slots[arg] ?? `unlisted expression: ${arg}`)).toEqual(listed!.args);
    },
  );

  it("has no RAISE with a USING clause (DETAIL/HINT would bypass the format check)", () => {
    for (const { sql } of sources) expect(sql).not.toMatch(/RAISE[^;]*\bUSING\b/i);
  });
});

describe("installQueryErrorSanitizer", () => {
  it("sanitizes errors where Drizzle creates them, so systemDb() errors never carry params", async () => {
    installQueryErrorSanitizer();
    installQueryErrorSanitizer(); // idempotent: never wraps twice
    const query = Object.create(PgPreparedQuery.prototype) as {
      queryWithCache(query: string, params: unknown[], run: () => Promise<unknown>): Promise<unknown>;
    };
    const error = await query
      .queryWithCache('insert into "users" ("email") values ($1)', [NAME, MRN], () =>
        Promise.reject(uniqueViolation()),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DatabaseError);
    expect((error as DatabaseError).code).toBe("23505");
    expect(surface(error)).not.toContain(NAME);
    expect(surface(error)).not.toContain(MRN);
    expect(stderr).toHaveLength(1); // logged once, not once per wrapper
  });
});

describe("robustness", () => {
  it("doesn't trust a Node socket code (no severity) as a SQLSTATE", () => {
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    const sanitized = sanitizeDatabaseError(drizzleError(epipe)) as DatabaseError;
    expect(sanitized.code).toBeUndefined();
    expect(sanitized.message).toBe("Database query failed");
  });

  it("recognizes a DatabaseError from another copy of this module (by name, not instanceof)", async () => {
    vi.resetModules();
    const other = await import("./errors");
    const foreign = new other.DatabaseError("Integrity constraint violation (SQLSTATE 23505)", "23505");
    expect(foreign).not.toBeInstanceOf(DatabaseError);
    expect(isUniqueViolation(foreign)).toBe(true);
    expect(sanitizeDatabaseError(foreign)).toBe(foreign);
  });

  it("wraps Drizzle's prototype once, even from a second copy of this module", async () => {
    installQueryErrorSanitizer();
    const wrapped = (PgPreparedQuery.prototype as unknown as { queryWithCache: unknown }).queryWithCache;
    vi.resetModules();
    (await import("./errors")).installQueryErrorSanitizer();
    expect((PgPreparedQuery.prototype as unknown as { queryWithCache: unknown }).queryWithCache).toBe(
      wrapped,
    );
  });

  it("replaces connection errors, which name hosts and roles", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432"), { code: "ECONNREFUSED" });
    const auth = pgError({
      message: 'password authentication failed for user "synthetic_role"',
      code: "28P01",
    });
    expect(sanitizeConnectionError(refused).message).toBe("Database connection failed");
    const sanitizedAuth = sanitizeConnectionError(auth);
    expect(sanitizedAuth.code).toBe("28P01");
    expect(surface(sanitizedAuth)).not.toContain("synthetic_role");
    expect(surface(sanitizeConnectionError(refused))).not.toContain("10.1.2.3");
  });
});
