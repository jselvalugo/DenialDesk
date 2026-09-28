/**
 * Outbound HTTPS transport for FHIR R4 connections (PI2a). `node:https` only — no new dependency
 * (ADR 0010: "No new runtime dependency before cutover"). Discovery, token requests, and search all
 * go through this one transport so the TLS options, address guard, redirect refusal, and limits
 * apply everywhere a connection reaches out to a practice's EHR/PM.
 */
import * as https from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { finished, pipeline, type Readable } from "node:stream";
import * as zlib from "node:zlib";
import {
  createGuardedLookup,
  isAddressGuardError,
  isAddressPermitted,
  type GuardedLookupOptions,
} from "./address-guard";
import { TransportError, isTransportError, type TransportErrorCode } from "./errors";
import { assertTestOnlyOption } from "./test-only";

export const FHIR_JSON = "application/fhir+json";
export const JSON_CONTENT = "application/json";
export const FORM_URLENCODED = "application/x-www-form-urlencoded";

/** "30 s total per request (DNS through body)" — spec PI2a "Limits (M1)". */
export const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
/** "10 MB per response after decompression" — spec PI2a "Limits (M1)". */
export const DEFAULT_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * TLS 1.2 cipher suites: ECDHE key exchange with AES-GCM or ChaCha20-Poly1305 only (forward secrecy,
 * AEAD). TLS 1.3 suites are not affected by this option and stay at OpenSSL's defaults.
 */
export const TLS12_CIPHERS = [
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
].join(":");

/**
 * Request headers a caller may not set: the transport owns framing and routing (request smuggling /
 * Host spoofing), and sets `Accept` and `Content-Type` itself from the typed fields.
 */
const FORBIDDEN_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "proxy-authorization",
  "proxy-connection",
  "accept",
  "content-type",
]);

export interface TransportRequestInit {
  url: URL;
  method: "GET" | "POST";
  /** Pre-encoded request body (form-encoded for token/POST `_search`). Requires `contentType`. */
  body?: string;
  contentType?: string;
  /** Content types this call will accept; the response's `Content-Type` must match one of these. */
  accept: readonly string[];
  headers?: Readonly<Record<string, string>>;
}

export interface TransportResponse {
  status: number;
  /** The response's `Content-Type`, lower-cased and without parameters (e.g. `; charset=utf-8`). */
  contentType: string | undefined;
  body: string;
}

/**
 * What every FHIR-facing caller (discovery, auth, search — PI2a part 2 / PI2b) depends on, so a
 * synthetic sandbox transport (PI2b's `SandboxTransport`, in-process, no network) can stand in for
 * it in non-production without those callers knowing the difference.
 */
export interface Transport {
  request(init: TransportRequestInit): Promise<TransportResponse>;
}

const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "HOSTNAME_MISMATCH",
  "EPROTO",
]);

function isTlsErrorCode(code: string): boolean {
  return TLS_ERROR_CODES.has(code) || code.startsWith("ERR_TLS") || code.startsWith("ERR_SSL");
}

/**
 * Collapses a raw Node/OpenSSL/DNS error into the spec's outcome codes. Never inspects or repeats
 * the error's message (it can carry a hostname or path) beyond deciding which bucket it falls in.
 */
export function collapseTransportError(err: unknown): TransportError {
  if (isTransportError(err)) return err;
  const guardError = isAddressGuardError(err);
  if (guardError) return guardError;
  const e = err as (NodeJS.ErrnoException & { name?: string }) | undefined;
  if (e?.name === "AbortError" || e?.code === "ABORT_ERR") return new TransportError("timeout");
  const code = e?.code ?? "";
  if (isTlsErrorCode(code)) return new TransportError("tls_failed");
  return new TransportError("unreachable");
}

/**
 * Fails fast if global TLS verification has been switched off in this process. Called at transport
 * construction ("fail at startup", spec PI2a bullet 1) and exported so it can also be asserted
 * anywhere else that matters and unit-tested directly.
 */
export function assertTlsVerificationEnabled(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") {
    throw new Error(
      "NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS certificate verification for the whole process; " +
        "refusing to start the FHIR transport (CLAUDE.md #6, R-7.4.x).",
    );
  }
}

function contentTypeOf(res: IncomingMessage): string | undefined {
  const raw = res.headers["content-type"];
  if (!raw) return undefined;
  return raw.split(";")[0]?.trim().toLowerCase();
}

type Decompressor = zlib.Gunzip | zlib.BrotliDecompress | zlib.Inflate;

/**
 * Picks a decompressing stream for the response's `Content-Encoding`: `null` for none (absent or
 * `identity`), a stream for gzip/deflate/br, and `"unsupported"` for anything else (including a
 * stacked list such as `gzip, br`), which the caller refuses.
 */
function decompressorFor(res: IncomingMessage): Decompressor | null | "unsupported" {
  const encoding = res.headers["content-encoding"]?.trim().toLowerCase();
  if (!encoding || encoding === "identity") return null;
  if (encoding === "gzip" || encoding === "x-gzip") return zlib.createGunzip();
  if (encoding === "br") return zlib.createBrotliDecompress();
  if (encoding === "deflate") return zlib.createInflate();
  return "unsupported";
}

export interface HttpsTransportOptions {
  /**
   * Test-only (throws outside a test/synthetic environment): trusts this CA instead of Node's
   * bundled store, so a test server's self-signed certificate verifies.
   */
  ca?: string | Buffer;
  /**
   * Test-only (throws outside a test/synthetic environment): OR'd with the default address guard,
   * so a test server on loopback (refused by default) can be reached. Applies to both DNS-resolved
   * addresses and IP-literal hosts.
   */
  allowAddress?: GuardedLookupOptions["allowAddress"];
  /**
   * Test-only (throws outside a test/synthetic environment): total per-request wall-clock budget,
   * DNS through body. Default `DEFAULT_TOTAL_TIMEOUT_MS`.
   */
  totalTimeoutMs?: number;
  /**
   * Test-only (throws outside a test/synthetic environment): cap on the response body after
   * decompression. Default `DEFAULT_MAX_RESPONSE_BYTES`.
   */
  maxResponseBytes?: number;
  /** Test-only (throws outside a test/synthetic environment): replaces the DNS resolver. */
  resolve?: GuardedLookupOptions["resolve"];
}

/**
 * `node:https`-based `Transport`. TLS options are explicit and fixed (`minVersion: 'TLSv1.2'`, an
 * ECDHE + AEAD-only TLS 1.2 cipher list, `rejectUnauthorized: true`, `servername` = the request host
 * for hostnames, Node's bundled CA store — plus `NODE_EXTRA_CA_CERTS`, which the deployment must not
 * set); every request goes through a private `https.Agent` this instance owns, never the
 * module-level default agent. Environment proxies are ignored: on Node 22.21+/24 `node:https` honors
 * `HTTPS_PROXY` only for the global agent when `NODE_USE_ENV_PROXY=1` is set at process start, or
 * for an `Agent` constructed with `proxyEnv`; ours is private and has neither. A 3xx response is
 * refused rather than followed. Every DNS-resolved address is checked by the guarded `lookup` hook
 * (`./address-guard.ts`), and IP-literal hosts (for which Node never calls `lookup`) are checked
 * against the same rules in `request()` before any connection is made.
 */
export class HttpsTransport implements Transport {
  private readonly ca: string | Buffer | undefined;
  private readonly allowAddress: GuardedLookupOptions["allowAddress"];
  private readonly lookup: ReturnType<typeof createGuardedLookup>;
  private readonly totalTimeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly agent: https.Agent;

  constructor(options: HttpsTransportOptions = {}) {
    assertTlsVerificationEnabled();
    if (options.ca !== undefined) assertTestOnlyOption("ca");
    if (options.allowAddress) assertTestOnlyOption("allowAddress");
    if (options.totalTimeoutMs !== undefined) assertTestOnlyOption("totalTimeoutMs");
    if (options.maxResponseBytes !== undefined) assertTestOnlyOption("maxResponseBytes");
    if (options.resolve) assertTestOnlyOption("resolve");
    this.ca = options.ca;
    this.allowAddress = options.allowAddress;
    this.lookup = createGuardedLookup({ allowAddress: options.allowAddress, resolve: options.resolve });
    this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    // A private agent this instance owns: never Node's global default agent, and deliberately built
    // without `proxyEnv` so no proxy environment variable can route traffic through a proxy.
    this.agent = new https.Agent({ keepAlive: false });
  }

  async request(init: TransportRequestInit): Promise<TransportResponse> {
    // Re-parse with WHATWG `URL`, which normalizes numeric/hex/octal IPv4 forms (`2130706433`,
    // `0x7f.1` -> `127.0.0.1`) and IPv6 literals, so the checks below see the canonical host.
    const url = new URL(init.url.href);
    if (url.protocol !== "https:") {
      throw new TransportError("unreachable", "Only https: URLs are supported");
    }
    if (url.username || url.password) {
      // Node would send these as Basic auth on the first request.
      throw new TransportError("unreachable", "URLs carrying credentials are refused");
    }

    // Node never calls `lookup` for an IP-literal host, so the guard must run here for those.
    const host = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
    const literalFamily = isIP(host);
    if (literalFamily !== 0 && !isAddressPermitted(host, literalFamily as 4 | 6, this.allowAddress)) {
      throw new TransportError("address_refused");
    }

    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      const lower = name.toLowerCase();
      if (FORBIDDEN_REQUEST_HEADERS.has(lower)) {
        throw new TransportError("unreachable", "A request header is not permitted");
      }
      headers[lower] = value;
    }
    headers.accept = init.accept.join(", ");
    let bodyBuffer: Buffer | undefined;
    if (init.body !== undefined) {
      if (!init.contentType) throw new Error("contentType is required when body is set");
      bodyBuffer = Buffer.from(init.body, "utf8");
      headers["content-type"] = init.contentType;
      headers["content-length"] = String(bodyBuffer.byteLength);
    }

    // Total per-request budget, DNS through body — separate from (and not relying on) any socket
    // idle timeout, which would reset on every trickled byte and miss a deliberately slow response.
    const signal = AbortSignal.timeout(this.totalTimeoutMs);

    return await new Promise<TransportResponse>((resolve, reject) => {
      let settled = false;
      let req: ClientRequest | undefined;
      let response: IncomingMessage | undefined;
      let decompressor: Decompressor | undefined;

      const teardown = () => {
        req?.destroy();
        response?.destroy();
        decompressor?.destroy();
      };
      const onAbort = () => fail(new TransportError("timeout"));
      const settle = (fn: () => void): boolean => {
        if (settled) return false;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        fn();
        return true;
      };
      const fail = (error: TransportError) => {
        if (settle(() => reject(error))) teardown();
      };

      // Reject directly when the total budget expires, whatever the streams are (not) doing.
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });

      try {
        req = https.request(url, {
          method: init.method,
          headers,
          agent: this.agent,
          minVersion: "TLSv1.2",
          ciphers: TLS12_CIPHERS,
          rejectUnauthorized: true,
          // SNI is for hostnames only; an IP literal has none.
          servername: literalFamily === 0 ? url.hostname : undefined,
          ca: this.ca,
          lookup: this.lookup,
          signal,
        });

        req.on("error", (err) => fail(collapseTransportError(err)));

        req.on("response", (res) => {
          response = res;
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            fail(new TransportError("redirect_refused"));
            return;
          }

          const contentType = contentTypeOf(res);
          if (!contentType || !init.accept.some((accepted) => accepted.toLowerCase() === contentType)) {
            fail(new TransportError("content_type_refused"));
            return;
          }

          const chosen = decompressorFor(res);
          if (chosen === "unsupported") {
            // An encoding we can't safely bound (or don't know) is refused, not passed through.
            fail(new TransportError("content_type_refused", "Unsupported Content-Encoding"));
            return;
          }
          decompressor = chosen ?? undefined;

          const source: Readable = decompressor ?? res;
          if (decompressor) {
            // `pipeline` (not `res.pipe`) so a premature close or error on the response — or a
            // truncated compressed stream — destroys the decompressor and reports an error.
            pipeline(res, decompressor, (err) => {
              if (err) fail(collapseTransportError(err));
            });
          } else {
            finished(res, (err) => {
              if (err) fail(collapseTransportError(err));
            });
          }

          const chunks: Buffer[] = [];
          let total = 0;
          source.on("data", (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > this.maxResponseBytes) {
              fail(new TransportError("too_large"));
              return;
            }
            chunks.push(chunk);
          });
          // Needed in addition to pipeline's callback: zlib can report a truncated-but-cleanly-ended
          // stream ("unexpected end of file") as an 'error' after pipeline has already called back.
          source.on("error", (err: unknown) => fail(collapseTransportError(err)));
          source.on("end", () => {
            settle(() => resolve({ status, contentType, body: Buffer.concat(chunks).toString("utf8") }));
          });
        });

        if (bodyBuffer) req.write(bodyBuffer);
        req.end();
      } catch (err) {
        // `https.request` can throw synchronously (invalid header characters, bad options).
        fail(collapseTransportError(err));
      }
    });
  }
}

export type { TransportErrorCode };
export { TransportError };
