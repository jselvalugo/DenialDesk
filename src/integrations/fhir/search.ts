import { AccessTokenCache, requestAccessToken, type AccessToken } from "./auth";
import type { DiscoveryResult } from "./discovery";
import { isTransportError, type TransportErrorCode } from "./errors";
import { assertBundleEntryLimit, assertNextIsSameOrigin, PagingLoopGuard, RunBudget } from "./limits";
import { FhirConnectError } from "./outcomes";
import { FHIR_JSON, FORM_URLENCODED, type Transport, type TransportResponse } from "./transport";
import type { SyncFailureCode } from "./sync-codes";
import { bundleSchema, type FhirBundle } from "./types";
import type { JwtSigner } from "@/lib/crypto/jwt-sign";

// Authenticated FHIR search for the sync (docs/specs/patient-integrations.md PI2b "Search",
// "Retries"). Everything goes through the injected `Transport` (the guarded `HttpsTransport`, or the
// in-process `SandboxTransport`), so TLS, the address guard, redirect refusal, size and time limits
// apply. Callers of the transport **never log or store a non-2xx response body** (the transport
// discards it unread) and carry only fixed codes in errors: no URL, query string, header, token,
// resource, or ZodError ever reaches an error message, a log line, or the database.

/** Retries after the first attempt (spec "Retries: 3, exponential backoff"). */
export const MAX_RETRIES = 3;
/** First backoff delay; doubles each retry (1 s, 2 s, 4 s), capped at `MAX_BACKOFF_MS`. */
export const BASE_BACKOFF_MS = 1_000;
export const MAX_BACKOFF_MS = 30_000;
/** `Retry-After` is honored up to this many seconds (spec: capped at 60 s). */
export const RETRY_AFTER_CAP_SECONDS = 60;
/** `_count` of every patient page (spec "Search"). */
export const PAGE_SIZE = 100;
/** Patients per Coverage search: POST keeps ids out of the URL; GET keeps the URL short. */
const COVERAGE_POST_CHUNK = 50;
const COVERAGE_GET_CHUNK = 20;

export type { SyncFailureCode } from "./sync-codes";

/** A run-ending condition. Carries a code, the last HTTP status, and whether it puts the connection in `error`. */
export class SyncFailure extends Error {
  constructor(
    readonly code: SyncFailureCode,
    readonly options: { httpStatus?: number; connectionError?: boolean } = {},
  ) {
    super(code);
    this.name = "SyncFailure";
  }
  get httpStatus(): number | undefined {
    return this.options.httpStatus;
  }
  /** 401/403 or `invalid_client`, and a changed token endpoint: the connection goes to `error`. */
  get connectionError(): boolean {
    return this.options.connectionError === true;
  }
}

export function isSyncFailure(error: unknown): error is SyncFailure {
  return error instanceof SyncFailure;
}

/** Transport failures worth retrying: the network or the server had a bad moment. Nothing about the destination. */
const RETRYABLE_TRANSPORT_CODES: ReadonlySet<TransportErrorCode> = new Set(["timeout", "unreachable"]);
/** Statuses worth retrying: request timeout, too early, throttled, and server errors. */
function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export interface RetryPolicy {
  retries: number;
  baseDelayMs: number;
  sleep: (ms: number) => Promise<void>;
}

export const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function backoffDelayMs(attempt: number, policy: Pick<RetryPolicy, "baseDelayMs">): number {
  return Math.min(policy.baseDelayMs * 2 ** attempt, MAX_BACKOFF_MS);
}

/** The wait before retry number `attempt` (0-based): `Retry-After` capped at 60 s, else exponential. */
function retryDelayMs(attempt: number, policy: RetryPolicy, response?: TransportResponse): number {
  if (response?.retryAfterSeconds !== undefined) {
    return Math.min(response.retryAfterSeconds, RETRY_AFTER_CAP_SECONDS) * 1000;
  }
  return backoffDelayMs(attempt, policy);
}

/** Where the bearer token comes from, and how to drop it after a 401 (`AccessTokenCache.invalidate`). */
export interface TokenSource {
  get(): Promise<AccessToken>;
  invalidate(): void;
}

export interface TokenSourceInput {
  transport: Transport;
  connectionId: string;
  clientId: string;
  signer: JwtSigner;
  discovery: Pick<DiscoveryResult, "tokenEndpointAdvertised" | "scopes">;
  policy: RetryPolicy;
  now?: () => Date;
  cache?: AccessTokenCache;
}

/**
 * The token for one run: from the in-memory cache, else a new `client_credentials` request with a
 * signed assertion (`auth.ts`). Re-requested on expiry, or after one 401 (`invalidate`). A transient
 * failure of the token endpoint (`unreachable`) is retried like any other request; `auth_refused`
 * (401/403/`invalid_client`, any 4xx) is not: the credentials are wrong, not the network.
 */
export function createTokenSource(input: TokenSourceInput): TokenSource {
  const cache = input.cache ?? new AccessTokenCache(() => (input.now?.() ?? new Date()).getTime());
  return {
    invalidate: () => cache.invalidate(input.connectionId),
    async get() {
      const cached = cache.get(input.connectionId);
      if (cached) return cached;
      for (let attempt = 0; ; attempt += 1) {
        try {
          const grant = await requestAccessToken({
            transport: input.transport,
            tokenEndpoint: input.discovery.tokenEndpointAdvertised,
            clientId: input.clientId,
            signer: input.signer,
            scopes: input.discovery.scopes,
            now: input.now?.(),
          });
          cache.set(input.connectionId, grant);
          return grant.token;
        } catch (error) {
          if (
            error instanceof FhirConnectError &&
            error.outcome === "unreachable" &&
            attempt < input.policy.retries
          ) {
            await input.policy.sleep(backoffDelayMs(attempt, input.policy));
            continue;
          }
          throw error;
        }
      }
    },
  };
}

export interface FhirClientInput {
  transport: Transport;
  /** The connection's normalized base URL: `next` links must be same-origin with it. */
  base: URL;
  tokens: TokenSource;
  budget: RunBudget;
  policy: RetryPolicy;
}

interface RequestInit {
  method: "GET" | "POST";
  url: URL;
  form?: URLSearchParams;
}

type BundleResult = { bundle: FhirBundle } | { status: number };

/**
 * Authenticated, retrying, budgeted FHIR requests. Every request first asks the run budget whether it
 * may start (12 min / 5,000 requests / 500 MB, `limits.ts`) and reports what it cost afterwards.
 * 401 once -> a new token and one more try; 401 again or 403 -> `auth_refused` (the connection goes to
 * `error`); 408/425/429/5xx and `timeout`/`unreachable` -> up to three retries with exponential
 * backoff, `Retry-After` honored up to 60 s; anything else -> a fixed code, never a body.
 */
export class FhirClient {
  constructor(private readonly input: FhirClientInput) {}

  private async send(init: RequestInit, passStatuses: readonly number[]): Promise<TransportResponse> {
    const { transport, tokens, budget, policy } = this.input;
    let retries = 0;
    let reauthenticated = false;
    for (;;) {
      budget.assertCanStartRequest();
      const token = await tokens.get();
      let response: TransportResponse;
      try {
        response = await transport.request({
          url: init.url,
          method: init.method,
          accept: [FHIR_JSON],
          headers: { authorization: `Bearer ${token.reveal()}` },
          ...(init.form ? { body: init.form.toString(), contentType: FORM_URLENCODED } : {}),
        });
      } catch (error) {
        if (!isTransportError(error)) throw error;
        budget.recordRequest(0);
        if (RETRYABLE_TRANSPORT_CODES.has(error.code) && retries < policy.retries) {
          await policy.sleep(retryDelayMs(retries, policy));
          retries += 1;
          continue;
        }
        throw error;
      }
      budget.recordRequest(Buffer.byteLength(response.body, "utf8"));
      const { status } = response;
      if (status >= 200 && status < 300) return response;
      if (passStatuses.includes(status)) return response;
      if (status === 401 && !reauthenticated) {
        // "re-requested on expiry or one 401": drop the token and try once more with a new one.
        tokens.invalidate();
        reauthenticated = true;
        continue;
      }
      if (status === 401 || status === 403) {
        throw new SyncFailure("auth_refused", { httpStatus: status, connectionError: true });
      }
      if (isRetryableStatus(status) && retries < policy.retries) {
        await policy.sleep(retryDelayMs(retries, policy, response));
        retries += 1;
        continue;
      }
      throw new SyncFailure(isRetryableStatus(status) ? "unreachable" : "bad_response", {
        httpStatus: status,
      });
    }
  }

  /**
   * One request whose answer must be a searchset Bundle. `passStatuses` are statuses returned to the
   * caller instead of failing the run (a server that doesn't support POST `_search`).
   */
  async bundle(init: RequestInit, passStatuses: readonly number[] = []): Promise<BundleResult> {
    const response = await this.send(init, passStatuses);
    if (response.status < 200 || response.status >= 300) return { status: response.status };
    let json: unknown;
    try {
      json = JSON.parse(response.body);
    } catch {
      throw new SyncFailure("bad_response");
    }
    const parsed = bundleSchema.safeParse(json);
    if (!parsed.success) throw new SyncFailure("bad_response");
    assertBundleEntryLimit(parsed.data.entry?.length ?? 0);
    return { bundle: parsed.data };
  }

  /**
   * Follows `next` links from a first request: each must be same-origin with the base URL
   * (`assertNextIsSameOrigin`) and never repeat (`PagingLoopGuard`, `paging_loop`). Yields each Bundle.
   */
  async *pages(first: RequestInit): AsyncGenerator<FhirBundle> {
    const guard = new PagingLoopGuard();
    guard.check(first.url.href);
    let init = first;
    for (;;) {
      const result = await this.bundle(init);
      if (!("bundle" in result)) throw new SyncFailure("bad_response", { httpStatus: result.status });
      yield result.bundle;
      const next = result.bundle.link?.find((link) => link.relation === "next")?.url;
      if (!next) return;
      let nextUrl: URL;
      try {
        nextUrl = new URL(next, init.url);
      } catch {
        throw new SyncFailure("bad_response");
      }
      assertNextIsSameOrigin(this.input.base, nextUrl);
      guard.check(nextUrl.href);
      init = { method: "GET", url: nextUrl };
    }
  }
}

/** The `Patient` and `Coverage` searches of a sync (spec "Search"). */
export class PatientSearch {
  /** Whether POST `Coverage/_search` works on this server; learned on first use, per run. */
  private coveragePost = true;

  constructor(
    private readonly client: FhirClient,
    /** The connection's normalized base URL, no trailing slash. */
    private readonly baseUrl: string,
  ) {}

  /** `Patient?_lastUpdated=ge<watermark>&_count=<count>` (no `_lastUpdated` on the initial load). */
  patientUrl(watermark: Date | null, count: number): URL {
    const url = new URL(`${this.baseUrl}/Patient`);
    if (watermark) url.searchParams.set("_lastUpdated", `ge${watermark.toISOString()}`);
    url.searchParams.set("_count", String(count));
    return url;
  }

  /** The pages of a patient search; the caller stops reading when it must (a paused connection). */
  patientPages(watermark: Date | null, count: number = PAGE_SIZE): AsyncGenerator<FhirBundle> {
    return this.client.pages({ method: "GET", url: this.patientUrl(watermark, count) });
  }

  /**
   * The Coverage resources for these patients. By POST `Coverage/_search` (`patient=<id>,<id>`) where
   * the server supports it, so FHIR ids stay out of request URLs (threat model I7); a server that
   * answers 404/405/415/501 to it is searched by GET instead, in shorter chunks (⚠️ VERIFY per
   * vendor; documented in the spec: that URL goes only to the practice's own EHR). Every result page
   * is followed. Returns the raw `entry.resource` values.
   */
  async coverageFor(patientIds: readonly string[]): Promise<unknown[]> {
    const found: unknown[] = [];
    for (let index = 0; index < patientIds.length;) {
      const chunkSize = this.coveragePost ? COVERAGE_POST_CHUNK : COVERAGE_GET_CHUNK;
      const ids = patientIds.slice(index, index + chunkSize);
      let bundles: FhirBundle[] | null = null;
      if (this.coveragePost) {
        bundles = await this.coveragePostSearch(ids);
        if (bundles === null) continue; // just switched to GET: redo this chunk in smaller pieces
      }
      for (const bundle of bundles ?? (await this.collect(this.coverageGetUrl(ids)))) {
        for (const entry of bundle.entry ?? []) {
          if (entry.search?.mode !== "outcome") found.push(entry.resource);
        }
      }
      index += ids.length;
    }
    return found;
  }

  private coverageGetUrl(ids: readonly string[]): URL {
    const url = new URL(`${this.baseUrl}/Coverage`);
    url.searchParams.set("patient", ids.join(","));
    url.searchParams.set("_count", String(PAGE_SIZE));
    return url;
  }

  private async collect(url: URL): Promise<FhirBundle[]> {
    const bundles: FhirBundle[] = [];
    for await (const bundle of this.client.pages({ method: "GET", url })) bundles.push(bundle);
    return bundles;
  }

  /** null when the server doesn't support POST search (then `coveragePost` is switched off). */
  private async coveragePostSearch(ids: readonly string[]): Promise<FhirBundle[] | null> {
    const form = new URLSearchParams({ patient: ids.join(","), _count: String(PAGE_SIZE) });
    const first = await this.client.bundle(
      { method: "POST", url: new URL(`${this.baseUrl}/Coverage/_search`), form },
      [404, 405, 415, 501],
    );
    if (!("bundle" in first)) {
      this.coveragePost = false;
      return null;
    }
    // The first page came from the POST; a `next` link, if any, is a GET the server built.
    const bundles = [first.bundle];
    let current = first.bundle;
    const guard = new PagingLoopGuard();
    for (;;) {
      const next = current.link?.find((link) => link.relation === "next")?.url;
      if (!next) return bundles;
      let nextUrl: URL;
      try {
        nextUrl = new URL(next, `${this.baseUrl}/`);
      } catch {
        throw new SyncFailure("bad_response");
      }
      assertNextIsSameOrigin(new URL(this.baseUrl), nextUrl);
      guard.check(nextUrl.href);
      const result = await this.client.bundle({ method: "GET", url: nextUrl });
      if (!("bundle" in result)) throw new SyncFailure("bad_response", { httpStatus: result.status });
      bundles.push(result.bundle);
      current = result.bundle;
    }
  }
}
