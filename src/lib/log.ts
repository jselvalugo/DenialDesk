/**
 * The only logger allowed in DenialDesk (eslint bans console).
 * Accepts an event name plus IDs and a few numeric/status fields. Free-form objects are rejected
 * so claim and patient fields can't reach logs (CLAUDE.md non-negotiable 4, R-7.4.8).
 */
type LogValue = string | number | boolean;
export type LogFields = Record<string, LogValue>;
type Level = "debug" | "info" | "warn" | "error";

const ALLOWED_EXTRA_KEYS = new Set(["durationMs", "count", "status", "attempt"]);

/**
 * Keys whose values come from code, not users (route templates, error class names, schema
 * identifiers). The value must match its pattern, so a request path with a query string or free
 * text can't reach logs under one of these names.
 */
export const LOG_VALUE_PATTERNS: Record<string, RegExp> = {
  route: /^\/[A-Za-z0-9_\-/[\]().@]*$/,
  routeType: /^[a-z]{1,16}$/,
  digest: /^[A-Za-z0-9]{1,64}$/,
  errorName: /^[A-Za-z][A-Za-z0-9]{0,63}$/,
  constraint: /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/,
};
const EVENT_NAME = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;
const ID_KEY = /^[a-z][A-Za-z0-9]*Id$/;
const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Names that look like an ID key but hold a value that isn't a database primary key (patient
 * integrations threat model I1): a FHIR id, a member/subscriber ID, an OAuth client ID, and a
 * source `versionId` string can all carry or hint at PHI, or (client ID) a business identifier.
 * Refused outright rather than merely UUID-checked, since none of them is ever UUID-shaped anyway.
 */
const DENYLISTED_ID_KEYS = new Set(["externalId", "memberId", "clientId", "sourceVersionId"]);

export function isAllowedKey(key: string): boolean {
  if (DENYLISTED_ID_KEYS.has(key)) return false;
  return ID_KEY.test(key) || ALLOWED_EXTRA_KEYS.has(key) || Object.hasOwn(LOG_VALUE_PATTERNS, key);
}

export function buildLogRecord(level: Level, event: string, fields: LogFields = {}) {
  if (!EVENT_NAME.test(event)) {
    throw new Error(`Log event must look like "area.action", got "${event}"`);
  }
  const rejected = Object.keys(fields).filter((key) => !isAllowedKey(key));
  if (rejected.length > 0) {
    throw new Error(
      `Log fields must be IDs (…Id) or ${[...ALLOWED_EXTRA_KEYS, ...Object.keys(LOG_VALUE_PATTERNS)].join("/")}: ${rejected.join(", ")}`,
    );
  }
  const malformed = Object.entries(fields)
    .filter(
      ([key, value]) =>
        Object.hasOwn(LOG_VALUE_PATTERNS, key) && !LOG_VALUE_PATTERNS[key]!.test(String(value)),
    )
    .map(([key]) => key);
  if (malformed.length > 0) {
    throw new Error(`Log field values don't match their pattern: ${malformed.join(", ")}`);
  }
  // An `…Id` key must actually carry a database ID; anything else is dropped rather than logged
  // (a bug upstream should not also leak whatever non-ID value it passed).
  const kept = Object.fromEntries(
    Object.entries(fields).filter(([key, value]) => !ID_KEY.test(key) || UUID_SHAPED.test(String(value))),
  );
  return { ts: new Date().toISOString(), level, event, ...kept };
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
