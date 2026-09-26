import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/db/tenant";
import { onRequestError } from "@/instrumentation";
import { buildLogRecord } from "./log";
import { requestErrorFields } from "./request-error";

const NAME = "Synthia Testpatient";
const context = { routePath: "/patients/[id]", routeType: "action" };

describe("requestErrorFields", () => {
  it("logs route, digest, error name and SQLSTATE for a database error, never the message", () => {
    const error = Object.assign(new DatabaseError(`Integrity constraint violation ${NAME}`, "23505"), {
      digest: "2847361905",
    });
    const fields = requestErrorFields(error, context);
    expect(fields).toEqual({
      route: "/patients/[id]",
      routeType: "action",
      digest: "2847361905",
      errorName: "DatabaseError",
      status: "23505",
    });
    expect(JSON.stringify(buildLogRecord("error", "request.unhandled_error", fields))).not.toContain(NAME);
  });

  it("never logs the message, stack, or cause of other errors", () => {
    const error = new Error(`Failed for ${NAME}`, { cause: new Error(NAME) });
    const fields = requestErrorFields(error, context);
    expect(fields).toEqual({ route: "/patients/[id]", routeType: "action", errorName: "Error" });
  });

  it("replaces values that don't look like a route, digest, or class name", () => {
    const error = { name: `Error: ${NAME}`, digest: `NEXT;${NAME}`, code: NAME };
    const fields = requestErrorFields(error, { routePath: `/patients?name=${NAME}`, routeType: NAME });
    expect(fields).toEqual({ route: "unknown", routeType: "unknown", errorName: "unknown" });
  });

  it("logs a SQLSTATE-looking code only for sanitized database errors", () => {
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    expect(requestErrorFields(epipe, context)).not.toHaveProperty("status");
  });

  it("handles thrown non-errors", () => {
    expect(requestErrorFields(undefined, context).errorName).toBe("unknown");
    expect(requestErrorFields(NAME, context)).not.toHaveProperty("status");
  });
});

describe("onRequestError", () => {
  const error = Object.assign(new DatabaseError(`Integrity ${NAME}`, "23505"), { digest: "123" });
  const request = { path: `/patients?name=${NAME}`, method: "POST", headers: {} };
  const errorContext = {
    routerKind: "App Router",
    routePath: "/patients",
    routeType: "action",
    revalidateReason: undefined,
  } as const;
  let stderr: string[];
  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("writes one record with route, digest, error name and SQLSTATE only", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    await onRequestError(error, request, errorContext);
    expect(stderr).toHaveLength(1);
    const record = JSON.parse(stderr[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "error",
      event: "request.unhandled_error",
      route: "/patients",
      routeType: "action",
      digest: "123",
      errorName: "DatabaseError",
      status: "23505",
    });
    expect(stderr[0]).not.toContain(NAME);
  });

  it("does nothing outside the Node.js runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    await onRequestError(error, request, errorContext);
    expect(stderr).toHaveLength(0);
  });
});
