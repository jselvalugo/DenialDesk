import { createPublicKey, randomBytes, verify as cryptoVerify } from "node:crypto";
import { syntheticDataOnly } from "@/lib/env";
import { isJwtAlg } from "@/lib/crypto/jwt-sign";
import { CLIENT_ASSERTION_TYPE } from "../auth";
import { SCOPES_BY_STYLE } from "../discovery";
import { TransportError } from "../errors";
import type { PublicJwk } from "../keys";
import {
  FHIR_JSON,
  FORM_URLENCODED,
  JSON_CONTENT,
  type Transport,
  type TransportRequestInit,
  type TransportResponse,
} from "../transport";
import { SANDBOX_BASE_URL, SANDBOX_CLIENT_ID, SANDBOX_HOST, SANDBOX_TOKEN_ENDPOINT } from "../url-rules";
import { SandboxDataset, type FhirJson, type SandboxPatient } from "./dataset";

// The in-process synthetic FHIR server behind `SandboxTransport` (docs/specs/patient-integrations.md
// PI2b "Synthetic sandbox"). No network, no sockets: a `Transport` that answers, for the sandbox base
// URL `https://sandbox.fhir.denialdesk.invalid/r4` only, exactly what a SMART Backend Services FHIR R4
// server answers: `metadata`, `.well-known/smart-configuration`, a token endpoint that **verifies the
// client assertion** (signature against the registered public key, algorithm allow-list, `aud`,
// `exp`, `jti` remembered until `exp`), and authenticated `Patient` and `Coverage` searches over the
// deterministic synthetic dataset. It exists so Test connection, Submit and Sync now work in every
// non-production environment, and it is refused everywhere else.

const NOT_ALLOWED =
  "The synthetic sandbox transport is only available where only synthetic data is allowed (CLAUDE.md non-negotiable 1).";

/** Thrown when a `SandboxTransport` is asked for where real data is allowed. Never carries data. */
export class SandboxNotPermittedError extends Error {
  constructor() {
    super(NOT_ALLOWED);
    this.name = "SandboxNotPermittedError";
  }
}

/** Access-token lifetime the sandbox grants (seconds). */
export const SANDBOX_TOKEN_TTL_SECONDS = 300;
/** Largest `exp - iat` an assertion may claim (SMART Backend Services: 5 minutes). */
const MAX_ASSERTION_LIFETIME_SECONDS = 300;
/** Clock skew tolerated on `iat`. */
const IAT_SKEW_SECONDS = 60;
const MAX_PAGE = 100;
const DEFAULT_PAGE = 20;

/**
 * What the sandbox remembers between requests: assertion `jti`s until their `exp` (replay refusal) and
 * the access tokens it has issued. Process-wide by default, so a replay is caught across requests in
 * one server instance; tests pass their own.
 */
export class SandboxState {
  readonly jtis = new Map<string, number>();
  readonly tokens = new Map<string, { expiresAtMs: number; scope: string }>();

  /** Records a `jti` until `expSeconds`; false if it was already seen (a replay). */
  rememberJti(jti: string, expSeconds: number, nowMs: number): boolean {
    for (const [seen, exp] of this.jtis) if (exp * 1000 <= nowMs) this.jtis.delete(seen);
    if (this.jtis.has(jti)) return false;
    this.jtis.set(jti, expSeconds);
    return true;
  }
}

const sharedState = new SandboxState();

export interface SandboxTransportOptions {
  /**
   * The public keys of the client the sandbox trusts (its JWKS): the signing key store's public
   * material. The sandbox has no keys of its own, so an assertion signed by anything else is refused.
   */
  publicKeys: () => Promise<readonly PublicJwk[]>;
  /** Overrides `syntheticDataOnly()` (tests only). The transport refuses to exist where it is false. */
  synthetic?: () => boolean;
  dataset?: SandboxDataset;
  now?: () => Date;
  state?: SandboxState;
}

interface Route {
  status: number;
  contentType: string;
  body?: unknown;
}

const empty = (status: number): Route => ({ status, contentType: JSON_CONTENT });
const ok = (contentType: string, body: unknown): Route => ({ status: 200, contentType, body });

function b64uJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** A `Transport` that is the synthetic FHIR server. Chosen from `is_sandbox` alone, never the host. */
export class SandboxTransport implements Transport {
  private readonly synthetic: () => boolean;
  private readonly dataset: SandboxDataset;
  private readonly now: () => Date;
  private readonly state: SandboxState;

  constructor(private readonly options: SandboxTransportOptions) {
    this.synthetic = options.synthetic ?? syntheticDataOnly;
    if (!this.synthetic()) throw new SandboxNotPermittedError();
    this.dataset = options.dataset ?? new SandboxDataset();
    this.now = options.now ?? (() => new Date());
    this.state = options.state ?? sharedState;
  }

  async request(init: TransportRequestInit): Promise<TransportResponse> {
    // Checked on every request as well as at construction.
    if (!this.synthetic()) throw new SandboxNotPermittedError();
    const url = new URL(init.url.href);
    // Only the sandbox's own origin: nothing else can be "dialed" through here.
    if (
      url.protocol !== "https:" ||
      url.hostname !== SANDBOX_HOST ||
      url.port !== "" ||
      url.username ||
      url.password
    ) {
      throw new TransportError("unreachable");
    }
    const route = await this.route(init, url);
    if (route.status >= 200 && route.status < 300) {
      // The real transport refuses a 2xx whose Content-Type the caller didn't accept.
      if (!init.accept.some((accepted) => accepted.toLowerCase() === route.contentType)) {
        throw new TransportError("content_type_refused");
      }
      return { status: route.status, contentType: route.contentType, body: JSON.stringify(route.body ?? {}) };
    }
    // A non-2xx body is never delivered (transport N3): status only.
    return { status: route.status, contentType: route.contentType, body: "" };
  }

  private async route(init: TransportRequestInit, url: URL): Promise<Route> {
    const path = url.pathname.replace(/\/+$/, "");
    if (path === new URL(SANDBOX_TOKEN_ENDPOINT).pathname) {
      return init.method === "POST" ? this.token(init) : empty(405);
    }
    const base = new URL(SANDBOX_BASE_URL).pathname;
    if (!path.startsWith(`${base}/`)) return empty(404);
    const resource = path.slice(base.length + 1);
    if (resource === "metadata" && init.method === "GET") return ok(FHIR_JSON, this.capabilityStatement());
    if (resource === ".well-known/smart-configuration" && init.method === "GET") {
      return ok(JSON_CONTENT, this.smartConfiguration());
    }
    const scope = this.authorize(init);
    if (scope === null) return empty(401);
    if (resource === "Patient" && init.method === "GET") return this.searchPatients(url, scope);
    if (resource === "Coverage" && init.method === "GET") return this.searchCoverage(url.searchParams, scope);
    if (resource === "Coverage/_search" && init.method === "POST") {
      if (init.contentType !== FORM_URLENCODED) return empty(415);
      return this.searchCoverage(new URLSearchParams(init.body ?? ""), scope);
    }
    return empty(404);
  }

  // -- Discovery ----------------------------------------------------------------------------------

  private capabilityStatement(): FhirJson {
    return {
      resourceType: "CapabilityStatement",
      status: "active",
      date: "2025-01-01",
      kind: "instance",
      fhirVersion: "4.0.1",
      format: ["json"],
      implementation: { description: "DenialDesk synthetic sandbox (synthetic data only)" },
      rest: [
        {
          mode: "server",
          resource: [
            {
              type: "Patient",
              interaction: [{ code: "read" }, { code: "search-type" }],
              searchParam: [
                { name: "_lastUpdated", type: "date" },
                { name: "identifier", type: "token" },
              ],
            },
            {
              type: "Coverage",
              interaction: [{ code: "search-type" }],
              searchParam: [{ name: "patient", type: "reference" }],
            },
            { type: "Organization", interaction: [{ code: "read" }] },
          ],
        },
      ],
    };
  }

  private smartConfiguration(): FhirJson {
    return {
      token_endpoint: SANDBOX_TOKEN_ENDPOINT,
      token_endpoint_auth_methods_supported: ["private_key_jwt"],
      token_endpoint_auth_signing_alg_values_supported: ["ES384", "RS384"],
      capabilities: ["permission-v2", "client-confidential-asymmetric"],
    };
  }

  // -- Token endpoint -----------------------------------------------------------------------------

  /**
   * SMART Backend Services token request. Every refusal is a bare 401 (`invalid_client`), with no
   * reason: like a real server, it says nothing about which check failed. The `jti` is remembered
   * only for an assertion that passed every other check, until its `exp`.
   */
  private async token(init: TransportRequestInit): Promise<Route> {
    if (init.contentType !== FORM_URLENCODED) return empty(415);
    const form = new URLSearchParams(init.body ?? "");
    if (form.get("grant_type") !== "client_credentials") return empty(400);
    if (form.get("client_assertion_type") !== CLIENT_ASSERTION_TYPE) return empty(401);
    const claims = await this.verifiedClaims(form.get("client_assertion") ?? "");
    if (!claims) return empty(401);

    const allowed = new Set([...SCOPES_BY_STYLE.v2.split(" "), ...SCOPES_BY_STYLE.v1.split(" ")]);
    const scope = (form.get("scope") ?? "")
      .split(/\s+/)
      .filter((requested) => allowed.has(requested))
      .join(" ");
    const accessToken = `sandbox-token-${randomBytes(24).toString("base64url")}`;
    this.state.tokens.set(accessToken, {
      expiresAtMs: this.now().getTime() + SANDBOX_TOKEN_TTL_SECONDS * 1000,
      scope,
    });
    return ok(JSON_CONTENT, {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: SANDBOX_TOKEN_TTL_SECONDS,
      scope,
    });
  }

  /** The assertion's claims if it is a valid, unreplayed assertion from the sandbox client; else null. */
  private async verifiedClaims(assertion: string): Promise<Record<string, unknown> | null> {
    const parts = assertion.split(".");
    if (parts.length !== 3 || parts.some((part) => part === "")) return null;
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
    const header = b64uJson(headerPart);
    const claims = b64uJson(payloadPart);
    if (!header || !claims) return null;

    // Algorithm allow-list, and never "none": ES384 or RS384 only, and the key must be for it.
    if (!isJwtAlg(header.alg) || typeof header.kid !== "string" || header.typ !== "JWT") return null;
    const key = (await this.options.publicKeys()).find(
      (candidate) => candidate.kid === header.kid && candidate.alg === header.alg,
    );
    if (!key) return null;
    const signature = Buffer.from(signaturePart, "base64url");
    let signatureValid = false;
    try {
      const jwk = Object.fromEntries(
        Object.entries({ kty: key.kty, crv: key.crv, x: key.x, y: key.y, n: key.n, e: key.e }).filter(
          ([, value]) => value !== undefined,
        ),
      );
      const publicKey = createPublicKey({ key: jwk, format: "jwk" });
      const signingInput = Buffer.from(`${headerPart}.${payloadPart}`, "ascii");
      signatureValid =
        header.alg === "ES384"
          ? cryptoVerify("sha384", signingInput, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)
          : cryptoVerify("sha384", signingInput, publicKey, signature);
    } catch {
      return null;
    }
    if (!signatureValid) return null;

    const nowSeconds = Math.floor(this.now().getTime() / 1000);
    const { iss, sub, aud, iat, exp, jti } = claims;
    if (iss !== SANDBOX_CLIENT_ID || sub !== SANDBOX_CLIENT_ID) return null;
    if (aud !== SANDBOX_TOKEN_ENDPOINT) return null;
    if (typeof iat !== "number" || typeof exp !== "number" || typeof jti !== "string" || jti === "")
      return null;
    if (
      exp <= nowSeconds ||
      iat > nowSeconds + IAT_SKEW_SECONDS ||
      exp - iat > MAX_ASSERTION_LIFETIME_SECONDS
    ) {
      return null;
    }
    if (!this.state.rememberJti(jti, exp, this.now().getTime())) return null;
    return claims;
  }

  /** The scope of a valid bearer token, or null (missing, unknown, or expired). */
  private authorize(init: TransportRequestInit): string | null {
    const header = init.headers?.authorization ?? init.headers?.Authorization;
    const token = /^Bearer (\S+)$/.exec(header ?? "")?.[1];
    const entry = token ? this.state.tokens.get(token) : undefined;
    if (!entry || entry.expiresAtMs <= this.now().getTime()) return null;
    return entry.scope;
  }

  // -- Searches -----------------------------------------------------------------------------------

  private pageWindow(params: URLSearchParams): { count: number; offset: number } | null {
    const rawCount = params.get("_count");
    const rawOffset = params.get("_offset");
    const count = rawCount === null ? DEFAULT_PAGE : Number(rawCount);
    const offset = rawOffset === null ? 0 : Number(rawOffset);
    if (!Number.isInteger(count) || count < 1 || !Number.isInteger(offset) || offset < 0) return null;
    return { count: Math.min(count, MAX_PAGE), offset };
  }

  private bundle(url: URL, all: FhirJson[], window: { count: number; offset: number }): Route {
    const slice = all.slice(window.offset, window.offset + window.count);
    const link: FhirJson[] = [{ relation: "self", url: url.href }];
    if (window.offset + window.count < all.length) {
      const next = new URL(url.href);
      next.searchParams.set("_count", String(window.count));
      next.searchParams.set("_offset", String(window.offset + window.count));
      link.push({ relation: "next", url: next.href });
    }
    return ok(FHIR_JSON, {
      resourceType: "Bundle",
      type: "searchset",
      // The server's own clock: the sync clamps it and derives its watermark from it.
      meta: { lastUpdated: this.now().toISOString() },
      total: all.length,
      link,
      entry: slice.map((resource) => ({
        fullUrl: `${SANDBOX_BASE_URL}/${String(resource.resourceType)}/${String(resource.id)}`,
        resource,
        search: { mode: "match" },
      })),
    });
  }

  private searchPatients(url: URL, scope: string): Route {
    if (!/system\/Patient\.(rs|read)\b/.test(scope)) return empty(403);
    const window = this.pageWindow(url.searchParams);
    if (!window) return empty(400);
    let patients: SandboxPatient[] = [...this.dataset.patients];
    const lastUpdated = url.searchParams.get("_lastUpdated");
    if (lastUpdated !== null) {
      const match = /^ge(.+)$/.exec(lastUpdated);
      const since = match ? new Date(match[1]!) : null;
      if (!since || Number.isNaN(since.getTime())) return empty(400);
      patients = patients.filter((patient) => patient.lastUpdated.getTime() >= since.getTime());
    }
    patients.sort((a, b) => a.lastUpdated.getTime() - b.lastUpdated.getTime() || a.id.localeCompare(b.id));
    return this.bundle(
      url,
      patients.map((patient) => patient.resource),
      window,
    );
  }

  private searchCoverage(params: URLSearchParams, scope: string): Route {
    if (!/system\/Coverage\.(rs|read)\b/.test(scope)) return empty(403);
    const window = this.pageWindow(params);
    const ids = (params.get("patient") ?? "")
      .split(",")
      .map((value) => value.trim().replace(/^Patient\//, ""))
      .filter((value) => value !== "");
    if (!window || ids.length === 0) return empty(400);
    const wanted = new Set(ids);
    const coverages = this.dataset.patients
      .filter((patient) => wanted.has(patient.id))
      .flatMap((patient) => patient.coverages);
    // A POST's `next` link is a GET on `Coverage`, so the search (the patient list) and the paging
    // window live in that URL, not in the form.
    const target = new URL(`${SANDBOX_BASE_URL}/Coverage`);
    target.searchParams.set("patient", ids.join(","));
    return this.bundle(target, coverages, window);
  }
}
