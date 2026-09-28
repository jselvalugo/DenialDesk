import { createHash } from "node:crypto";
import { isIPv6 } from "node:net";
import { lt, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { rateLimits } from "@/db/schema";
import { requestContext } from "./request-context";

/**
 * Fixed-window rate limits per client network (spec: docs/specs/rate-limiting.md, R-7.4.7).
 * Counters live in PostgreSQL so limits hold across serverless instances. Security policy,
 * not legal rules.
 */
export type Bucket =
  | "sign_in"
  | "mfa"
  | "seed"
  | "integration_test_connection"
  | "integration_test_practice"
  | "integration_submit"
  | "jwks";

const POLICY: Record<Bucket, { limit: number; windowSeconds: number; env?: string }> = {
  sign_in: { limit: 30, windowSeconds: 15 * 60, env: "RATE_LIMIT_SIGNIN" },
  mfa: { limit: 30, windowSeconds: 15 * 60, env: "RATE_LIMIT_MFA" },
  seed: { limit: 5, windowSeconds: 60 * 60 },
  // "Test connection" dials a practice-supplied host, so it is limited per connection and per
  // practice, separately from sign-in (docs/specs/patient-integrations.md PI2a; threat model D2).
  integration_test_connection: { limit: 5, windowSeconds: 10 * 60 },
  integration_test_practice: { limit: 20, windowSeconds: 10 * 60 },
  // Submit attempts per practice (PI2a): a refused Submit says whether an endpoint and client ID are
  // already registered by some practice, so probing that is bounded like probing hosts is.
  integration_submit: { limit: 10, windowSeconds: 10 * 60 },
  // Public JWKS reads, per client network; EHRs fetch a key at token time, not per request.
  jwks: { limit: 120, windowSeconds: 60 },
};

export function limitFor(bucket: Bucket): { limit: number; windowSeconds: number } {
  const policy = POLICY[bucket];
  const override = policy.env ? Number(process.env[policy.env]) : NaN;
  return {
    limit: Number.isInteger(override) && override > 0 ? override : policy.limit,
    windowSeconds: policy.windowSeconds,
  };
}

/** Salted so the table can't be reversed into IP addresses with a lookup table. */
function hashKey(bucket: Bucket, key: string): string {
  const salt = process.env.FIELD_ENCRYPTION_KEY ?? "";
  return createHash("sha256").update(`${salt}:${bucket}:${key}`).digest("hex");
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Records one hit for `key` in `bucket` and says whether it's within the limit. Atomic. */
export async function hit(bucket: Bucket, key: string, now: Date = new Date()): Promise<RateLimitResult> {
  const { limit, windowSeconds } = limitFor(bucket);
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
  const [row] = await systemDb()
    .insert(rateLimits)
    .values({ bucket, keyHash: hashKey(bucket, key), windowStart, hits: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.bucket, rateLimits.keyHash, rateLimits.windowStart],
      set: { hits: sql`${rateLimits.hits} + 1` },
    })
    .returning({ hits: rateLimits.hits });

  // Occasional cleanup of windows older than a day.
  if (Math.random() < 0.01) {
    await systemDb()
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, new Date(now.getTime() - 24 * 60 * 60 * 1000)));
  }

  const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
  return { allowed: (row?.hits ?? 1) <= limit, retryAfterSeconds };
}

/**
 * A client IPv6 address's /64 (the network a single subscriber controls: one host can rotate through
 * 2^64 addresses inside it), written as its first four hextets. An IPv4-mapped (`::ffff:a.b.c.d`) or
 * IPv4-compatible (`::a.b.c.d`) address is keyed by its embedded IPv4, so IPv4 clients reported in
 * mapped form don't all share one bucket. Anything that isn't IPv6 is returned unchanged.
 */
export function ipv6Network64(ip: string): string {
  if (!isIPv6(ip)) return ip;
  const address = ip.split("%")[0]!;
  // An embedded dotted IPv4 tail is two hextets; expand it before counting groups for "::".
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address);
  const hex = dotted
    ? address.slice(0, dotted.index) +
      [
        ((Number(dotted[1]) << 8) | Number(dotted[2])).toString(16),
        ((Number(dotted[3]) << 8) | Number(dotted[4])).toString(16),
      ].join(":")
    : address;
  const [head = "", tail] = hex.split("::") as [string, string?];
  const groups = (part: string) => (part === "" ? [] : part.split(":"));
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const gap = tail === undefined ? 0 : 8 - left.length - right.length;
  const full = [...left, ...Array<string>(gap).fill("0"), ...right].map((group) =>
    parseInt(group || "0", 16),
  );
  const embedsIpv4 = full.slice(0, 5).every((group) => group === 0) && (full[5] === 0xffff || full[5] === 0);
  if (embedsIpv4 && (full[6] !== 0 || (full[7] ?? 0) > 1)) {
    return [full[6]! >> 8, full[6]! & 0xff, full[7]! >> 8, full[7]! & 0xff].join(".");
  }
  return full
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(":")
    .concat("::/64");
}

/**
 * Rate-limits the current request by client IP (all unknown-IP requests share one bucket). The public
 * `jwks` bucket keys an IPv6 client by its /64 so one subscriber can't multiply its allowance by
 * rotating addresses; the other buckets are unchanged.
 */
export async function limitCurrentRequest(bucket: Bucket): Promise<RateLimitResult> {
  const { ip } = await requestContext();
  return hit(bucket, clientKey(bucket, ip));
}

/** The key one client is counted under in `bucket` (exported for tests). */
export function clientKey(bucket: Bucket, ip: string | null): string {
  if (!ip) return "unknown";
  return bucket === "jwks" ? ipv6Network64(ip) : ip;
}

export function retryMessage(what: string, result: RateLimitResult): string {
  const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
  return `Too many ${what} from your network. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
