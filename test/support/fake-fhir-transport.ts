/**
 * In-process fake `Transport` for tests of discovery, the token request, and Test connection (spec
 * PI2a part 2: "use an in-process fake in tests"). No network, no sockets. PI2b builds the real
 * synthetic `SandboxTransport`; this is only a scripted stand-in. Every value is synthetic.
 */
import type {
  Transport,
  TransportRequestInit,
  TransportResponse,
} from "../../src/integrations/fhir/transport";

export const FAKE_BASE_URL = "https://fhir.example.com/r4";
export const FAKE_TOKEN_ENDPOINT = "https://auth.example.com/oauth2/token";
export const FAKE_CLIENT_ID = "client-synthetic-1";
export const FAKE_ACCESS_TOKEN = "SYNTHETIC-ACCESS-TOKEN-do-not-log";

type Route =
  | TransportResponse
  | Error
  | ((init: TransportRequestInit) => TransportResponse | Promise<TransportResponse>);

/** A 2xx JSON response (`application/json` unless told otherwise). */
export function jsonResponse(
  body: unknown,
  contentType = "application/json",
  status = 200,
): TransportResponse {
  return { status, contentType, body: typeof body === "string" ? body : JSON.stringify(body) };
}

/** What the real transport returns for a non-2xx: the status only, the body discarded (reviewer N3). */
export function statusOnly(status: number): TransportResponse {
  return { status, contentType: "text/html", body: "" };
}

export function capabilityStatement(overrides: Record<string, unknown> = {}) {
  return {
    resourceType: "CapabilityStatement",
    status: "active",
    fhirVersion: "4.0.1",
    implementation: { description: "Synthetic EHR", url: "https://fhir.example.com/r4" },
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
    ...overrides,
  };
}

export function smartConfiguration(overrides: Record<string, unknown> = {}) {
  return {
    token_endpoint: FAKE_TOKEN_ENDPOINT,
    token_endpoint_auth_methods_supported: ["private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["ES384", "RS384"],
    capabilities: ["permission-v2", "client-confidential-asymmetric"],
    ...overrides,
  };
}

export function tokenResponse(overrides: Record<string, unknown> = {}) {
  return {
    access_token: FAKE_ACCESS_TOKEN,
    token_type: "bearer",
    expires_in: 300,
    scope: "system/Patient.rs system/Coverage.rs system/Organization.rs",
    ...overrides,
  };
}

/** Scripted responses keyed by `METHOD https://host/path` (no query string). */
export class FakeFhirTransport implements Transport {
  readonly requests: TransportRequestInit[] = [];
  private readonly routes = new Map<string, Route>();

  constructor(routes: Record<string, Route> = {}) {
    for (const [key, route] of Object.entries(routes)) this.routes.set(key, route);
  }

  /** A server that passes every check: FHIR 4.0.1, SMART v2 with private_key_jwt, and a token endpoint. */
  static healthy(): FakeFhirTransport {
    return new FakeFhirTransport({
      [`GET ${FAKE_BASE_URL}/metadata`]: jsonResponse(capabilityStatement(), "application/fhir+json"),
      [`GET ${FAKE_BASE_URL}/.well-known/smart-configuration`]: jsonResponse(smartConfiguration()),
      [`POST ${FAKE_TOKEN_ENDPOINT}`]: jsonResponse(tokenResponse()),
    });
  }

  set(key: string, route: Route): this {
    this.routes.set(key, route);
    return this;
  }

  /** The form fields of the `n`th (default last) POST, decoded. */
  postedForm(index = -1): URLSearchParams {
    const posts = this.requests.filter((r) => r.method === "POST");
    return new URLSearchParams(posts.at(index)?.body ?? "");
  }

  async request(init: TransportRequestInit): Promise<TransportResponse> {
    this.requests.push(init);
    const url = new URL(init.url.href);
    const route = this.routes.get(`${init.method} ${url.origin}${url.pathname}`);
    if (!route) return statusOnly(404);
    if (route instanceof Error) throw route;
    if (typeof route === "function") return route(init);
    return route;
  }
}
