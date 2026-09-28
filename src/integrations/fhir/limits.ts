/**
 * Request and run-level limits (PI2a spec bullet "Limits (M1)"; threat model D1/D2/D4). Everything
 * here is a size/time/count budget, not a legal value (CLAUDE.md: legal deadlines and thresholds
 * live only in `rules/`; these are transport-layer denial-of-service guards).
 */
import { createHash } from "node:crypto";
import { TransportError } from "./errors";

/** "≤ 1,000 entries per Bundle". */
export const MAX_BUNDLE_ENTRIES = 1_000;

/** Refuses a Bundle page with more entries than the cap; never logs or throws the entry count's content. */
export function assertBundleEntryLimit(entryCount: number, max: number = MAX_BUNDLE_ENTRIES): void {
  if (entryCount > max) {
    throw new TransportError("too_large", `Bundle page has more than ${max} entries`);
  }
}

export interface RunBudgetLimits {
  /** "12 min wall clock". */
  wallClockMs: number;
  /** "5,000 requests". */
  maxRequests: number;
  /** "500 MB". */
  maxBytes: number;
}

/** Per-run budget from the spec (PI2a "Limits (M1)"). */
export const DEFAULT_RUN_BUDGET: RunBudgetLimits = {
  wallClockMs: 12 * 60 * 1000,
  maxRequests: 5_000,
  maxBytes: 500 * 1024 * 1024,
};

/**
 * Tracks one sync run's spend against the wall-clock, request-count, and byte budgets. The caller
 * checks in before every request (`assertCanStartRequest`) and reports actual usage after
 * (`recordRequest`), so a run that is already over budget refuses to start one more page rather
 * than discovering the overage only after paying for it (threat model D4: "Platform time limits
 * kill a run" — this stops the run itself well before that, with a clean, resumable code).
 */
export class RunBudget {
  private readonly limits: RunBudgetLimits;
  private readonly clock: () => number;
  private readonly startedAtMs: number;
  private requestCount = 0;
  private byteTotal = 0;

  constructor(limits: RunBudgetLimits = DEFAULT_RUN_BUDGET, clock: () => number = Date.now) {
    this.limits = limits;
    this.clock = clock;
    this.startedAtMs = clock();
  }

  get elapsedMs(): number {
    return this.clock() - this.startedAtMs;
  }

  get requestsMade(): number {
    return this.requestCount;
  }

  get bytesTransferred(): number {
    return this.byteTotal;
  }

  /** Throws (never logs a URL) if the run has already exhausted any of its three budgets. */
  assertCanStartRequest(): void {
    if (this.elapsedMs > this.limits.wallClockMs) {
      throw new TransportError("timeout", "Run wall-clock budget exceeded");
    }
    if (this.requestCount >= this.limits.maxRequests) {
      throw new TransportError("too_large", "Run request budget exceeded");
    }
    if (this.byteTotal >= this.limits.maxBytes) {
      throw new TransportError("too_large", "Run byte budget exceeded");
    }
  }

  /** Records one completed request's cost against the run. */
  recordRequest(bytesTransferred: number): void {
    this.requestCount += 1;
    this.byteTotal += bytesTransferred;
  }
}

/**
 * Stops a run that keeps being handed the same `next` page URL (a buggy or malicious server could
 * otherwise loop a sync run forever). URLs are hashed, not stored, so nothing that could later be
 * serialized or dumped from this guard's state carries a query string (spec: "Never include URLs
 * with query strings ... in errors or logs").
 */
export class PagingLoopGuard {
  private readonly seen = new Set<string>();

  /** Throws `paging_loop` the second time the same `next` URL is seen; otherwise records it. */
  check(nextUrl: string): void {
    const key = createHash("sha256").update(nextUrl).digest("hex");
    if (this.seen.has(key)) {
      throw new TransportError("paging_loop", "Repeated next-page URL");
    }
    this.seen.add(key);
  }
}

/**
 * "`next` must be same-origin as the base URL" (spec PI2a; threat model I8). Compares scheme, host,
 * and port only — never logs either URL.
 */
export function assertNextIsSameOrigin(baseUrl: URL, nextUrl: URL): void {
  if (baseUrl.protocol !== nextUrl.protocol || baseUrl.host !== nextUrl.host) {
    throw new TransportError(
      "address_refused",
      "next page URL is not same-origin as the connection's base URL",
    );
  }
}
