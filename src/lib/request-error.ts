import type { LogFields } from "./log";

const ROUTE = /^\/[A-Za-z0-9_\-/[\]().@]*$/;
const DIGEST = /^[A-Za-z0-9]{1,64}$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Log fields for an unhandled server error (R-7.4.8, CLAUDE.md #4): the route template (never the
 * request path, which can carry query strings), the digest shown to the user, the error's class
 * name, and its SQLSTATE. Never the message, stack, or cause. Values that don't look like what
 * Next.js or our code produce are replaced with "unknown" or dropped.
 */
export function requestErrorFields(
  error: unknown,
  context: { routePath: string; routeType: string },
): LogFields {
  const fields: LogFields = {
    route: ROUTE.test(context.routePath) ? context.routePath : "unknown",
    routeType: /^[a-z]{1,16}$/.test(context.routeType) ? context.routeType : "unknown",
  };
  const { digest, name, code } = (error ?? {}) as { digest?: unknown; name?: unknown; code?: unknown };
  if (typeof digest === "string" && DIGEST.test(digest)) fields.digest = digest;
  fields.errorName = typeof name === "string" && ERROR_NAME.test(name) ? name : "unknown";
  if (typeof code === "string" && SQLSTATE.test(code)) fields.status = code;
  return fields;
}
