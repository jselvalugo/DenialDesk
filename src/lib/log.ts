/**
 * The only logger allowed in DenialDesk (eslint bans console).
 * Accepts an event name plus IDs and a few numeric/status fields. Free-form objects are rejected
 * so claim and patient fields can't reach logs (CLAUDE.md non-negotiable 4, R-7.4.8).
 */
type LogValue = string | number | boolean;
export type LogFields = Record<string, LogValue>;
type Level = "debug" | "info" | "warn" | "error";

// route/routeType/digest/errorName/constraint carry code-defined values (route templates, error
// class names, schema identifiers); callers validate them first (src/lib/request-error.ts,
// src/db/tenant.ts).
const ALLOWED_EXTRA_KEYS = new Set([
  "durationMs",
  "count",
  "status",
  "attempt",
  "route",
  "routeType",
  "digest",
  "errorName",
  "constraint",
]);
const EVENT_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;

export function isAllowedKey(key: string): boolean {
  return /^[a-z][A-Za-z0-9]*Id$/.test(key) || ALLOWED_EXTRA_KEYS.has(key);
}

export function buildLogRecord(level: Level, event: string, fields: LogFields = {}) {
  if (!EVENT_NAME.test(event)) {
    throw new Error(`Log event must look like "area.action", got "${event}"`);
  }
  const rejected = Object.keys(fields).filter((key) => !isAllowedKey(key));
  if (rejected.length > 0) {
    throw new Error(
      `Log fields must be IDs (…Id) or ${[...ALLOWED_EXTRA_KEYS].join("/")}: ${rejected.join(", ")}`,
    );
  }
  return { ts: new Date().toISOString(), level, event, ...fields };
}

function write(level: Level, event: string, fields?: LogFields) {
  const line = JSON.stringify(buildLogRecord(level, event, fields));
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export const log = {
  debug: (event: string, fields?: LogFields) => write("debug", event, fields),
  info: (event: string, fields?: LogFields) => write("info", event, fields),
  warn: (event: string, fields?: LogFields) => write("warn", event, fields),
  error: (event: string, fields?: LogFields) => write("error", event, fields),
};
