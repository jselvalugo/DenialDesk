import { describe, expect, it } from "vitest";
import {
  capabilityStatement,
  FAKE_BASE_URL,
  FAKE_TOKEN_ENDPOINT,
  FakeFhirTransport,
  jsonResponse,
  smartConfiguration,
  statusOnly,
} from "../../../test/support/fake-fhir-transport";
import { discover, REQUIRED_FHIR_VERSION, SCOPES_BY_STYLE } from "./discovery";
import { TransportError } from "./errors";
import { FhirConnectError } from "./outcomes";
import { SANDBOX_BASE_URL } from "./url-rules";

const META = `GET ${FAKE_BASE_URL}/metadata`;
const SMART = `GET ${FAKE_BASE_URL}/.well-known/smart-configuration`;

function server(opts: { statement?: Record<string, unknown>; smart?: Record<string, unknown> } = {}) {
  return new FakeFhirTransport({
    [META]: jsonResponse(capabilityStatement(opts.statement), "application/fhir+json"),
    [SMART]: jsonResponse(smartConfiguration(opts.smart)),
  });
}

async function outcomeOf(transport: FakeFhirTransport, options?: Parameters<typeof discover>[2]) {
  const error = await discover(transport, FAKE_BASE_URL, options).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(FhirConnectError);
  return error as FhirConnectError;
}

/** A CapabilityStatement whose Patient/Coverage search parameters are replaced. */
function withSearch(patient: string[], coverage: string[], interaction?: { code: string }[]) {
  const resource = (type: string, names: string[]) => ({
    type,
    ...(interaction ? { interaction } : {}),
    searchParam: names.map((name) => ({ name, type: "string" })),
  });
  return {
    rest: [{ mode: "server", resource: [resource("Patient", patient), resource("Coverage", coverage)] }],
  };
}

describe("discover — success", () => {
  it("returns the pinned token endpoint, key, algorithms, scope style, and issuer", async () => {
    const transport = server();
    const result = await discover(transport, FAKE_BASE_URL);
    expect(result).toEqual({
      tokenEndpoint: FAKE_TOKEN_ENDPOINT,
      tokenEndpointKey: FAKE_TOKEN_ENDPOINT,
      algs: ["ES384", "RS384"],
      scopeStyle: "v2",
      scopes: "system/Patient.rs system/Coverage.rs system/Organization.rs",
      issuer: `${FAKE_BASE_URL} ${FAKE_BASE_URL}`,
    });
  });

  it("fetches metadata as application/fhir+json and smart-configuration as application/json, GET only", async () => {
    const transport = server();
    await discover(transport, `${FAKE_BASE_URL}/`);
    expect(transport.requests.map((r) => [r.method, r.url.pathname, r.accept])).toEqual([
      ["GET", "/r4/metadata", ["application/fhir+json"]],
      ["GET", "/r4/.well-known/smart-configuration", ["application/json"]],
    ]);
    expect(transport.requests.every((r) => r.body === undefined)).toBe(true);
  });

  it("uses permission-v1 scopes when only permission-v1 is advertised", async () => {
    const result = await discover(server({ smart: { capabilities: ["permission-v1"] } }), FAKE_BASE_URL);
    expect(result.scopeStyle).toBe("v1");
    expect(result.scopes).toBe("system/Patient.read system/Coverage.read system/Organization.read");
  });

  it("prefers permission-v2 when both are advertised", async () => {
    const result = await discover(
      server({ smart: { capabilities: ["permission-v1", "permission-v2"] } }),
      FAKE_BASE_URL,
    );
    expect(result.scopeStyle).toBe("v2");
    expect(result.scopes).toBe(SCOPES_BY_STYLE.v2);
  });

  it("accepts an RS384-only server and lists only allowed algorithms", async () => {
    const result = await discover(
      server({ smart: { token_endpoint_auth_signing_alg_values_supported: ["RS256", "RS384", "none"] } }),
      FAKE_BASE_URL,
    );
    expect(result.algs).toEqual(["RS384"]);
  });

  it("records only the base URL as issuer when implementation.url is absent or not acceptable", async () => {
    for (const implementation of [undefined, {}, { url: "http://insecure.example.com/r4" }, { url: 5 }]) {
      const statement = capabilityStatement();
      const transport = new FakeFhirTransport({
        [META]: jsonResponse(
          implementation === undefined
            ? { ...statement, implementation: undefined }
            : { ...statement, implementation },
          "application/fhir+json",
        ),
        [SMART]: jsonResponse(smartConfiguration()),
      });
      // `{ url: 5 }` fails the schema outright; the others just drop the second half.
      if (implementation && typeof implementation.url === "number") {
        expect((await outcomeOf(transport)).outcome).toBe("not_fhir_r4");
      } else {
        expect((await discover(transport, FAKE_BASE_URL)).issuer).toBe(FAKE_BASE_URL);
      }
    }
  });

  it("normalizes the token endpoint (trailing slash dropped, host lower-cased) into its registry key", async () => {
    const result = await discover(
      server({ smart: { token_endpoint: "https://AUTH.Example.com/OAuth2/Token/" } }),
      FAKE_BASE_URL,
    );
    expect(result.tokenEndpoint).toBe("https://auth.example.com/OAuth2/Token");
    expect(result.tokenEndpointKey).toBe("https://auth.example.com/oauth2/token");
  });
});

describe("discover — not_fhir_r4", () => {
  it.each(["4.0.0", "4.3.0", "3.0.2", "4.0.1-rc", ""])("fhirVersion %j is refused", async (fhirVersion) => {
    expect((await outcomeOf(server({ statement: { fhirVersion } }))).outcome).toBe("not_fhir_r4");
  });

  it("requires exactly 4.0.1", () => {
    expect(REQUIRED_FHIR_VERSION).toBe("4.0.1");
  });

  it.each([
    ["not a CapabilityStatement", { resourceType: "Bundle", fhirVersion: "4.0.1" }],
    ["fhirVersion missing", { fhirVersion: undefined }],
    ["fhirVersion a number", { fhirVersion: 4 }],
  ])("%s", async (_name, statement) => {
    expect((await outcomeOf(server({ statement }))).outcome).toBe("not_fhir_r4");
  });

  it("a metadata body that isn't JSON", async () => {
    const transport = server().set(META, jsonResponse("<html>hi</html>", "application/fhir+json"));
    expect((await outcomeOf(transport)).outcome).toBe("not_fhir_r4");
  });

  it("a 404 on metadata", async () => {
    expect((await outcomeOf(server().set(META, statusOnly(404)))).outcome).toBe("not_fhir_r4");
  });

  it("a wrong Content-Type on metadata (transport content_type_refused)", async () => {
    const transport = server().set(META, new TransportError("content_type_refused"));
    const error = await outcomeOf(transport);
    expect(error.outcome).toBe("not_fhir_r4");
    expect(error.transportCode).toBe("content_type_refused");
  });
});

describe("discover — smart_config_invalid", () => {
  it.each([
    ["no private_key_jwt", { token_endpoint_auth_methods_supported: ["client_secret_basic"] }],
    ["auth methods missing", { token_endpoint_auth_methods_supported: undefined }],
    ["no allowed algorithm", { token_endpoint_auth_signing_alg_values_supported: ["RS256", "ES256"] }],
    ["algorithm list missing", { token_endpoint_auth_signing_alg_values_supported: undefined }],
    ["no permission-v1/v2", { capabilities: ["launch-standalone"] }],
    ["capabilities missing", { capabilities: undefined }],
    ["token_endpoint missing", { token_endpoint: undefined }],
    ["token_endpoint not a string", { token_endpoint: 42 }],
  ])("%s", async (_name, smart) => {
    expect((await outcomeOf(server({ smart }))).outcome).toBe("smart_config_invalid");
  });

  it.each([
    ["http", "http://auth.example.com/token"],
    ["credentials", "https://user:pw@auth.example.com/token"],
    ["a query string", "https://auth.example.com/token?tenant=1"],
    ["a fragment", "https://auth.example.com/token#x"],
    ["an IP literal", "https://203.0.113.9/token"],
    ["decimal IPv4", "https://2130706433/token"],
    ["hex IPv4", "https://0x7f.1/token"],
    ["an IPv6 literal", "https://[2001:db8::1]/token"],
    ["localhost", "https://localhost/token"],
    ["a .local host", "https://auth.local/token"],
    ["a .internal host", "https://auth.internal/token"],
    ["a single-label host", "https://auth/token"],
    ["a trailing-dot host", "https://auth.example.com./token"],
    ["a disallowed port", "https://auth.example.com:8443/token"],
    ["dot segments", "https://auth.example.com/a/../token"],
    ["percent escapes", "https://auth.example.com/to%6Ben"],
    ["an empty string", ""],
    ["the sandbox host on a real connection", "https://sandbox.fhir.denialdesk.invalid/r4/token"],
  ])("a token endpoint with %s fails the URL rules", async (_name, token_endpoint) => {
    expect((await outcomeOf(server({ smart: { token_endpoint } }))).outcome).toBe("smart_config_invalid");
  });

  it("a real connection may not adopt the sandbox host as its token endpoint, and a sandbox must", async () => {
    const sandboxToken = "https://sandbox.fhir.denialdesk.invalid/r4/token";
    const sandboxServer = () =>
      new FakeFhirTransport({
        [`GET ${SANDBOX_BASE_URL}/metadata`]: jsonResponse(capabilityStatement(), "application/fhir+json"),
        [`GET ${SANDBOX_BASE_URL}/.well-known/smart-configuration`]: jsonResponse(
          smartConfiguration({ token_endpoint: sandboxToken }),
        ),
      });
    const ok = await discover(sandboxServer(), SANDBOX_BASE_URL, { sandbox: true });
    expect(ok.tokenEndpoint).toBe(sandboxToken);
    const wrong = await discover(sandboxServer(), SANDBOX_BASE_URL).catch((e: unknown) => e);
    expect((wrong as FhirConnectError).outcome).toBe("smart_config_invalid");
    // ...and a sandbox connection can't be pointed at a real token endpoint either.
    const real = await discover(server(), FAKE_BASE_URL, { sandbox: true }).catch((e: unknown) => e);
    expect((real as FhirConnectError).outcome).toBe("smart_config_invalid");
  });

  it("a smart-configuration body that isn't JSON, and a 404", async () => {
    expect((await outcomeOf(server().set(SMART, jsonResponse("nope")))).outcome).toBe("smart_config_invalid");
    expect((await outcomeOf(server().set(SMART, statusOnly(404)))).outcome).toBe("smart_config_invalid");
  });

  it("an oversized smart-configuration (transport too_large)", async () => {
    const error = await outcomeOf(server().set(SMART, new TransportError("too_large")));
    expect(error.outcome).toBe("smart_config_invalid");
  });
});

describe("discover — capability_missing", () => {
  it.each([
    ["Patient _lastUpdated missing", withSearch(["identifier"], ["patient"])],
    ["Coverage patient missing", withSearch(["_lastUpdated"], ["beneficiary"])],
    ["Patient search-type not offered", withSearch(["_lastUpdated"], ["patient"], [{ code: "read" }])],
    ["no server rest", { rest: [{ mode: "client" }] }],
    ["no rest at all", { rest: undefined }],
    ["no Patient resource", { rest: [{ mode: "server", resource: [{ type: "Coverage" }] }] }],
  ])("%s", async (_name, statement) => {
    expect((await outcomeOf(server({ statement }))).outcome).toBe("capability_missing");
  });

  it("a match on the wrong resource type doesn't count", async () => {
    const statement = {
      rest: [
        {
          mode: "server",
          resource: [
            { type: "Patient", searchParam: [{ name: "identifier" }] },
            { type: "Observation", searchParam: [{ name: "_lastUpdated" }, { name: "patient" }] },
            { type: "Coverage", searchParam: [{ name: "patient" }] },
          ],
        },
      ],
    };
    expect((await outcomeOf(server({ statement }))).outcome).toBe("capability_missing");
  });

  it("is checked after the SMART configuration, so an unusable SMART config wins", async () => {
    const error = await outcomeOf(server({ statement: withSearch([], []), smart: { capabilities: [] } }));
    expect(error.outcome).toBe("smart_config_invalid");
  });
});

describe("discover — transport and status failures", () => {
  it.each([
    ["tls_failed", "tls_failed", "tls_failed"],
    ["unreachable", "unreachable", "unreachable"],
    ["timeout", "unreachable", "timeout"],
    ["address_refused", "unreachable", "address_refused"],
    ["redirect_refused", "unreachable", "redirect_refused"],
  ] as const)("transport %s -> outcome %s, code kept for security events", async (code, outcome, kept) => {
    const error = await outcomeOf(server().set(META, new TransportError(code)));
    expect(error.outcome).toBe(outcome);
    expect(error.transportCode).toBe(kept);
  });

  it.each([
    [401, "auth_refused"],
    [403, "auth_refused"],
    [429, "unreachable"],
    [500, "unreachable"],
    [503, "unreachable"],
    [404, "not_fhir_r4"],
    [400, "not_fhir_r4"],
  ] as const)(
    "metadata status %s -> %s (the status alone decides; the body was discarded)",
    async (status, outcome) => {
      expect((await outcomeOf(server().set(META, statusOnly(status)))).outcome).toBe(outcome);
    },
  );

  it("a 204 (no body) is not a valid metadata answer", async () => {
    const transport = server().set(META, { status: 204, contentType: "application/fhir+json", body: "" });
    expect((await outcomeOf(transport)).outcome).toBe("not_fhir_r4");
  });

  it("rethrows something that isn't a transport error (a bug is not a test outcome)", async () => {
    const boom = new Error("bug");
    await expect(discover(server().set(META, boom), FAKE_BASE_URL)).rejects.toBe(boom);
  });

  it("never dials a base URL today's rules refuse", async () => {
    const transport = server();
    for (const bad of ["http://fhir.example.com/r4", "https://localhost/r4", "https://10.0.0.1/r4", ""]) {
      const error = await discover(transport, bad).catch((e: unknown) => e);
      expect((error as FhirConnectError).outcome).toBe("unreachable");
    }
    expect(transport.requests).toHaveLength(0);
  });

  it("the outcome carries no remote text (error message is the fixed outcome code)", async () => {
    const error = await outcomeOf(server().set(META, statusOnly(500)));
    expect(error.message).toBe("unreachable");
  });
});
