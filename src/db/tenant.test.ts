import { DrizzleQueryError } from "drizzle-orm";
import { DatabaseError as PgDatabaseError } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError, sanitizeDatabaseError } from "./tenant";

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
  });

  it("logs only status and constraint", () => {
    sanitizeDatabaseError(drizzleError(uniqueViolation()));
    const record = JSON.parse(stderr.join("")) as Record<string, unknown>;
    expect(Object.keys(record).sort()).toEqual(["constraint", "event", "level", "status", "ts"]);
    expect(record).toMatchObject({ event: "db.query_failed", status: "23505" });
  });
});

describe("sanitizeDatabaseError: other errors", () => {
  it("keeps only the code for data exceptions (class 22), which quote the value", () => {
    const error = pgError({ message: `invalid input syntax for type date: "${NAME}"`, code: "22007" });
    const sanitized = sanitizeDatabaseError(drizzleError(error)) as DatabaseError;
    expect(sanitized.code).toBe("22007");
    expect(sanitized.message).toBe("Database query failed");
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

  it("passes non-database errors through and does not re-wrap a sanitized one", () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/claims;307;",
    });
    expect(sanitizeDatabaseError(redirect)).toBe(redirect);
    const sanitized = sanitizeDatabaseError(drizzleError(uniqueViolation()));
    expect(sanitizeDatabaseError(sanitized)).toBe(sanitized);
  });
});
