import { z } from "zod";
import type { JwtAlg } from "@/lib/crypto/jwt-sign";
import { FHIR_JSON, JSON_CONTENT, type Transport } from "./transport";
import {
  FhirConnectError,
  outcomeForStatus,
  outcomeForTransportError,
  type FailureOutcome,
} from "./outcomes";
import { checkBaseUrl, SANDBOX_HOST } from "./url-rules";

// SMART / FHIR discovery for a connection (docs/specs/patient-integrations.md PI2a "Discovery";
// SMART App Launch STU2 https://hl7.org/fhir/smart-app-launch/STU2/conformance.html ; FHIR R4
// CapabilityStatement https://hl7.org/fhir/R4/capabilitystatement.html). Everything goes through the
// injected `Transport`, so the TLS options, address guard, redirect refusal, and size and time limits
// apply. Nothing from either document is logged, stored, or returned beyond the fields below.

export const REQUIRED_FHIR_VERSION = "4.0.1";

/** Preference order: ES384 is smaller and faster; RS384 is the fallback for servers that only list it. */
const ALG_PREFERENCE: readonly JwtAlg[] = ["ES384", "RS384"];

export type ScopeStyle = "v2" | "v1";

/** Backend-services system scopes for Patient, Coverage, Organization (spec "Discovery"). */
export const SCOPES_BY_STYLE: Record<ScopeStyle, string> = {
  v2: "system/Patient.rs system/Coverage.rs system/Organization.rs",
  v1: "system/Patient.read system/Coverage.read system/Organization.read",
};

export interface DiscoveryResult {
  /**
   * The token endpoint **exactly as the server advertised it** (after `checkBaseUrl` validated it):
   * the client assertion's `aud` and the POST URL use this string, because that is what the server
   * compares. Never use the normalized form there.
   */
  tokenEndpointAdvertised: string;
  /**
   * Normalized token endpoint (host lower-cased, no trailing slash), to be pinned on the connection
   * and compared with the pin; also the basis of `tokenEndpointKey`.
   */
  tokenEndpoint: string;
  /** Registry key of the token endpoint (`url-rules.ts`), same normalization as the base URL's. */
  tokenEndpointKey: string;
  /**
   * The allowed signing algorithms the server accepts for `private_key_jwt`, in our preference order
   * (never empty). The connection's key must be one of them.
   */
  algs: readonly JwtAlg[];
  scopeStyle: ScopeStyle;
  /** The space-separated scopes to request for `scopeStyle`. */
  scopes: string;
  /**
   * Issuer to record: the normalized base URL, plus ` <implementation.url>` (normalized, and only
   * when it passes the URL rules) when the CapabilityStatement carries one.
   */
  issuer: string;
}

const smartConfigSchema = z.object({
  token_endpoint: z.string().max(2048),
  token_endpoint_auth_methods_supported: z.array(z.string()),
  token_endpoint_auth_signing_alg_values_supported: z.array(z.string()),
  // Optional: a server that doesn't advertise `permission-v2` is treated as v1 (spec "Discovery").
  capabilities: z.array(z.string()).optional(),
});

const searchParamSchema = z.object({ name: z.string() });
const capabilityStatementSchema = z.object({
  resourceType: z.literal("CapabilityStatement"),
  fhirVersion: z.string(),
  implementation: z.object({ url: z.string().optional() }).optional(),
  rest: z
    .array(
      z.object({
        mode: z.string(),
        searchParam: z.array(searchParamSchema).optional(),
        resource: z
          .array(
            z.object({
              type: z.string(),
              searchParam: z.array(searchParamSchema).optional(),
              interaction: z.array(z.object({ code: z.string() })).optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

type CapabilityStatement = z.infer<typeof capabilityStatementSchema>;

async function getJson(
  transport: Transport,
  url: URL,
  accept: string,
  unusable: FailureOutcome,
): Promise<unknown> {
  let response;
  try {
    response = await transport.request({ url, method: "GET", accept: [accept] });
  } catch (error) {
    throw outcomeForTransportError(error, unusable);
  }
  // A non-2xx body was discarded by the transport; only the status decides the outcome (reviewer N3).
  if (response.status !== 200) throw outcomeForStatus(response.status, unusable);
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new FhirConnectError(unusable);
  }
}

/** Whether the server advertises searching `type` by `param` (and search at all, when it lists interactions). */
function supportsSearch(
  statement: CapabilityStatement,
  type: string,
  param: string,
  serverWide = false,
): boolean {
  return (statement.rest ?? [])
    .filter((rest) => rest.mode === "server")
    .some((rest) =>
      (rest.resource ?? []).some(
        (resource) =>
          resource.type === type &&
          ((resource.searchParam ?? []).some((p) => p.name === param) ||
            // Servers may declare a parameter once for every resource type, at `rest.searchParam`
            // (allowed only for the base search parameter `_lastUpdated`, never for `patient`).
            (serverWide && (rest.searchParam ?? []).some((p) => p.name === param))) &&
          (resource.interaction === undefined || resource.interaction.some((i) => i.code === "search-type")),
      ),
    );
}

export interface DiscoverOptions {
  /** A sandbox connection's discovered endpoint must be the built-in sandbox host; a real one must not. */
  sandbox?: boolean;
}

/**
 * Discovers a connection's SMART Backend Services endpoint. Order matters for the outcome: `metadata`
 * first (is this FHIR R4 at all?), then `smart-configuration`. Throws `FhirConnectError` with a
 * collapsed outcome; never a message from the remote.
 */
export async function discover(
  transport: Transport,
  baseUrl: string,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const base = checkBaseUrl(baseUrl);
  // A stored base URL passed the rules at save; if today's rules refuse it, don't dial it.
  if (!base.ok) throw new FhirConnectError("unreachable");

  const metadata = await getJson(transport, new URL(`${base.baseUrl}/metadata`), FHIR_JSON, "not_fhir_r4");
  const parsedStatement = capabilityStatementSchema.safeParse(metadata);
  if (!parsedStatement.success || parsedStatement.data.fhirVersion !== REQUIRED_FHIR_VERSION) {
    throw new FhirConnectError("not_fhir_r4");
  }
  const statement = parsedStatement.data;

  const config = await getJson(
    transport,
    new URL(`${base.baseUrl}/.well-known/smart-configuration`),
    JSON_CONTENT,
    "smart_config_invalid",
  );
  const parsedConfig = smartConfigSchema.safeParse(config);
  if (!parsedConfig.success) throw new FhirConnectError("smart_config_invalid");
  const smart = parsedConfig.data;

  if (!smart.token_endpoint_auth_methods_supported.includes("private_key_jwt")) {
    throw new FhirConnectError("smart_config_invalid");
  }
  const algs = ALG_PREFERENCE.filter((candidate) =>
    smart.token_endpoint_auth_signing_alg_values_supported.includes(candidate),
  );
  if (algs.length === 0) throw new FhirConnectError("smart_config_invalid");

  const token = checkBaseUrl(smart.token_endpoint);
  if (!token.ok) throw new FhirConnectError("smart_config_invalid");
  // `checkBaseUrl` exempts the sandbox host from the `.invalid` refusal; a discovered endpoint may
  // only use it for the sandbox connection itself (spec "Endpoint registry").
  if ((token.host === SANDBOX_HOST) !== (options.sandbox === true)) {
    throw new FhirConnectError("smart_config_invalid");
  }

  // `permission-v2` -> v2 scopes; anything else is treated as v1 (`.read`). ⚠️ VERIFY per vendor: a
  // server that supports v2 but doesn't advertise it would need `.rs` scopes, and would answer
  // `capability_missing` (scope_insufficient) at the token request, not a silent wrong grant.
  const scopeStyle: ScopeStyle = (smart.capabilities ?? []).includes("permission-v2") ? "v2" : "v1";

  if (
    !supportsSearch(statement, "Patient", "_lastUpdated", true) ||
    !supportsSearch(statement, "Coverage", "patient")
  ) {
    throw new FhirConnectError("capability_missing");
  }

  const implementation = statement.implementation?.url ? checkBaseUrl(statement.implementation.url) : null;
  const issuer = implementation?.ok ? `${base.baseUrl} ${implementation.baseUrl}` : base.baseUrl;

  return {
    tokenEndpointAdvertised: smart.token_endpoint,
    tokenEndpoint: token.baseUrl,
    tokenEndpointKey: token.endpointKey,
    algs,
    scopeStyle,
    scopes: SCOPES_BY_STYLE[scopeStyle],
    issuer,
  };
}
