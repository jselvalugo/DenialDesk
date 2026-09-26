import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { rateLimits } from "@/db/schema";
import { requestContext } from "./request-context";

/**
 * Fixed-window rate limits per client network (spec: docs/specs/rate-limiting.md, R-7.4.7).
 * Counters live in PostgreSQL so limits hold across serverless instances. Security policy,
 * not legal rules.
 */
export type Bucket = "sign_in" | "mfa" | "seed";

const POLICY: Record<Bucket, { limit: number; windowSeconds: number; env?: string }> = {
  sign_in: { limit: 30, windowSeconds: 15 * 60, env: "RATE_LIMIT_SIGNIN" },
  mfa: { limit: 30, windowSeconds: 15 * 60, env: "RATE_LIMIT_MFA" },
  seed: { limit: 5, windowSeconds: 60 * 60 },
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

/** Rate-limits the current request by client IP (all unknown-IP requests share one bucket). */
export async function limitCurrentRequest(bucket: Bucket): Promise<RateLimitResult> {
  const { ip } = await requestContext();
  return hit(bucket, ip ?? "unknown");
}

export function retryMessage(what: string, result: RateLimitResult): string {
  const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
  return `Too many ${what} from your network. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}
