import { LOG_VALUE_PATTERNS, type LogFields } from "./log";

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Log fields for an unhandled server error (R-7.4.8, CLAUDE.md #4): the route template (never the
 * request path, which can carry query strings), the digest shown to the user, the error's class
 * name, and, for sanitized database errors, the SQLSTATE. Never the message, stack, or cause.
 * Values that don't match their log pattern are replaced with "unknown" or dropped.
 */
export function requestErrorFields(
  error: unknown,
  context: { routePath: string; routeType: string },
): LogFields {
  const valid = (key: string, value: unknown): value is string =>
    typeof value === "string" && LOG_VALUE_PATTERNS[key]!.test(value);
  const fields: LogFields = {
    route: valid("route", context.routePath) ? context.routePath : "unknown",
    routeType: valid("routeType", context.routeType) ? context.routeType : "unknown",
  };
  const { digest, name, code } = (error ?? {}) as { digest?: unknown; name?: unknown; code?: unknown };
  if (valid("digest", digest)) fields.digest = digest;
  fields.errorName = valid("errorName", name) ? name : "unknown";
  // Only sanitizeDatabaseError's output carries a SQLSTATE; Node's EPIPE etc. would look like one.
  if (name === "DatabaseError" && typeof code === "string" && SQLSTATE.test(code)) fields.status = code;
  return fields;
}
