import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Signed background jobs (docs/specs/patient-integrations.md "PI2b" Jobs; ADR 0012; threat model S5).
// Platform-neutral: no Netlify, no Next.js. A job is a POST whose body is exactly `{"runId":"<uuid>"}`
// and whose headers carry a Unix timestamp and an HMAC-SHA256 over `<timestamp>.<body>`, keyed by
// `INTEGRATION_JOB_SECRET`. The body is authenticated byte for byte, so nothing but the run ID can be
// added, and the timestamp is inside the MAC, so it can't be renewed on a captured request.

export const JOB_TIMESTAMP_HEADER = "x-denialdesk-job-timestamp";
export const JOB_SIGNATURE_HEADER = "x-denialdesk-job-signature";
/** The signature header is `v1=` and 64 lowercase hex characters (HMAC-SHA256). */
const SIGNATURE_PREFIX = "v1=";
/** How far a job's timestamp may be from the receiver's clock, either way (spec: 5-minute window). */
export const JOB_WINDOW_SECONDS = 5 * 60;
/** A job is a UUID in a tiny JSON object; anything bigger is refused before the MAC is computed. */
export const MAX_JOB_BODY_BYTES = 1024;
/** `INTEGRATION_JOB_SECRET` must be at least this many bytes (256 bits). */
export const MIN_JOB_SECRET_BYTES = 32;

const jobBody = z.strictObject({ runId: z.uuid() });

export type JobRefusal =
  "unsigned" | "bad_timestamp" | "stale" | "bad_signature" | "too_large" | "bad_payload";

/** Thrown when the secret is missing or too short: the job path refuses to run (never falls back). */
export class JobSecretError extends Error {
  constructor(readonly code: "missing_secret" | "weak_secret") {
    super(
      code === "missing_secret" ? "INTEGRATION_JOB_SECRET is not set" : "INTEGRATION_JOB_SECRET is too short",
    );
    this.name = "JobSecretError";
  }
}

/**
 * The job secret from the environment, or a `JobSecretError`. At least 32 bytes; the value is never
 * echoed. Signing and verifying both call this, so a process without a proper secret can neither send
 * nor accept a job (spec: "refuse to run when missing or too short").
 */
export function jobSecret(env: Record<string, string | undefined> = process.env): Buffer {
  const value = env.INTEGRATION_JOB_SECRET;
  if (value === undefined || value === "") throw new JobSecretError("missing_secret");
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length < MIN_JOB_SECRET_BYTES) throw new JobSecretError("weak_secret");
  return bytes;
}

function mac(secret: Buffer, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex");
}

/** The exact body of a job for `runId`. */
export function jobBodyFor(runId: string): string {
  return JSON.stringify({ runId });
}

/** Headers for `body`, signed at `now` (Unix seconds from the sender's clock). */
export function signJob(secret: Buffer, body: string, now: Date = new Date()): Record<string, string> {
  const timestamp = String(Math.floor(now.getTime() / 1000));
  return {
    [JOB_TIMESTAMP_HEADER]: timestamp,
    [JOB_SIGNATURE_HEADER]: `${SIGNATURE_PREFIX}${mac(secret, timestamp, body)}`,
  };
}

export interface HeaderReader {
  get(name: string): string | null;
}

export type Verified = { ok: true; runId: string } | { ok: false; refusal: JobRefusal };

/**
 * Checks a received job: size, headers present, timestamp inside the window, HMAC equal in constant
 * time, and only then the payload (`{ runId }` and nothing else). The order matters: nothing in the
 * body is parsed before the signature is proven, and every refusal before that point is the same to
 * the caller (the worker answers one status for all of them).
 */
export function verifyJob(
  secret: Buffer,
  body: string,
  headers: HeaderReader,
  now: Date = new Date(),
): Verified {
  if (Buffer.byteLength(body, "utf8") > MAX_JOB_BODY_BYTES) return { ok: false, refusal: "too_large" };
  const timestamp = headers.get(JOB_TIMESTAMP_HEADER);
  const signature = headers.get(JOB_SIGNATURE_HEADER);
  if (!timestamp || !signature) return { ok: false, refusal: "unsigned" };
  if (!/^[0-9]{1,12}$/.test(timestamp)) return { ok: false, refusal: "bad_timestamp" };
  const skew = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp));
  if (skew > JOB_WINDOW_SECONDS) return { ok: false, refusal: "stale" };
  if (
    !signature.startsWith(SIGNATURE_PREFIX) ||
    !/^[0-9a-f]{64}$/.test(signature.slice(SIGNATURE_PREFIX.length))
  ) {
    return { ok: false, refusal: "bad_signature" };
  }
  const given = Buffer.from(signature.slice(SIGNATURE_PREFIX.length), "hex");
  const expected = Buffer.from(mac(secret, timestamp, body), "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, refusal: "bad_signature" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, refusal: "bad_payload" };
  }
  const payload = jobBody.safeParse(parsed);
  if (!payload.success) return { ok: false, refusal: "bad_payload" };
  return { ok: true, runId: payload.data.runId };
}
