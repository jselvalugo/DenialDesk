import { describe, expect, it } from "vitest";
import { DatabaseError } from "@/db/tenant";
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

  it("handles thrown non-errors", () => {
    expect(requestErrorFields(undefined, context).errorName).toBe("unknown");
    expect(requestErrorFields(NAME, context)).not.toHaveProperty("status");
  });
});
