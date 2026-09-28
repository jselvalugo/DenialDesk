import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { z } from "zod";
import { signJwt, type JwtSigner } from "@/lib/crypto/jwt-sign";
import { FORM_URLENCODED, JSON_CONTENT, type Transport } from "./transport";
import { FhirConnectError, outcomeForStatus, outcomeForTransportError } from "./outcomes";

// SMART Backend Services authorization (docs/specs/patient-integrations.md PI2a "Token"; SMART App
// Launch STU2 https://hl7.org/fhir/smart-app-launch/STU2/backend-services.html ; RFC 7523 client
// assertion; RFC 6749 §4.4 / §5.1 token response). The token, the assertion, and every response body
// stay in memory: nothing here logs, audits, stores, or puts either in an error message.

export const CLIENT_ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

/** Assertion lifetime. SMART requires `exp` no more than 5 minutes ahead; 4 leaves room for clock skew. */
export const ASSERTION_LIFETIME_SECONDS = 240;
/** A token is treated as expired this long before the server says, so a request never races expiry. */
const EXPIRY_SKEW_MS = 30_000;
/** Never trust an `expires_in` beyond an hour; re-authenticating is cheap and bounds a stolen token. */
const MAX_TOKEN_LIFETIME_SECONDS = 3600;
const MAX_ACCESS_TOKEN_LENGTH = 16 * 1024;

export interface AssertionInput {
  clientId: string;
  /** The **pinned** token endpoint, exactly as stored (`aud`). */
  tokenEndpoint: string;
  signer: JwtSigner;
  now?: Date;
  jti?: string;
}

/** `iss = sub = client_id`, `aud` = pinned token endpoint, `iat`, `exp` ≤ iat + 5 min, unique `jti`. */
export async function buildClientAssertion(input: AssertionInput): Promise<string> {
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  return signJwt(input.signer, {
    iss: input.clientId,
    sub: input.clientId,
    aud: input.tokenEndpoint,
    iat,
    exp: iat + ASSERTION_LIFETIME_SECONDS,
    jti: input.jti ?? randomUUID(),
  });
}

/**
 * An access token that refuses to be serialized: `JSON.stringify`, template strings, `console.log`,
 * and `util.inspect` all show a placeholder, so it can't reach a log line or an error by accident.
 * The only way to read it is `reveal()`, which callers use once, to build an `Authorization` header.
 */
export class AccessToken {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  toJSON(): string {
    return "[redacted access token]";
  }
  toString(): string {
    return "[redacted access token]";
  }
  [inspect.custom](): string {
    return "[redacted access token]";
  }
}

export interface AccessGrant {
  token: AccessToken;
  /** Absolute time after which the token must not be used (already reduced by the skew margin). */
  expiresAtMs: number;
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1).max(MAX_ACCESS_TOKEN_LENGTH),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
  scope: z.string().max(4096).optional(),
});

export interface TokenRequestInput extends AssertionInput {
  transport: Transport;
  /** Space-separated scopes requested, and required in the response (spec: `scope_insufficient`). */
  scopes: string;
}

/**
 * One `client_credentials` request with a signed `client_assertion`. Outcomes are collapsed
 * (`FhirConnectError`): a 4xx from the token endpoint is `auth_refused`, a 5xx or transport failure
 * `unreachable`, an unusable answer `smart_config_invalid`, and a token that doesn't carry every
 * required scope `capability_missing` (detail `scope_insufficient`). Non-2xx bodies are discarded by
 * the transport before this code sees them.
 */
export async function requestAccessToken(input: TokenRequestInput): Promise<AccessGrant> {
  const assertion = await buildClientAssertion(input);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: input.scopes,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: assertion,
  }).toString();

  let response;
  try {
    response = await input.transport.request({
      url: new URL(input.tokenEndpoint),
      method: "POST",
      body,
      contentType: FORM_URLENCODED,
      accept: [JSON_CONTENT],
    });
  } catch (error) {
    throw outcomeForTransportError(error, "smart_config_invalid");
  }
  if (response.status !== 200) throw outcomeForStatus(response.status, "auth_refused");

  let parsed: z.ZodSafeParseResult<z.infer<typeof tokenResponseSchema>>;
  try {
    parsed = tokenResponseSchema.safeParse(JSON.parse(response.body));
  } catch {
    throw new FhirConnectError("smart_config_invalid", undefined, "bad_token_response");
  }
  if (!parsed.success || parsed.data.token_type.toLowerCase() !== "bearer") {
    throw new FhirConnectError("smart_config_invalid", undefined, "bad_token_response");
  }
  const granted = new Set((parsed.data.scope ?? "").split(/\s+/).filter(Boolean));
  if (
    !input.scopes
      .split(/\s+/)
      .filter(Boolean)
      .every((scope) => granted.has(scope))
  ) {
    throw new FhirConnectError("capability_missing", undefined, "scope_insufficient");
  }
  const lifetimeMs = Math.min(parsed.data.expires_in, MAX_TOKEN_LIFETIME_SECONDS) * 1000;
  return {
    token: new AccessToken(parsed.data.access_token),
    expiresAtMs: (input.now ?? new Date()).getTime() + lifetimeMs - EXPIRY_SKEW_MS,
  };
}

/**
 * In-memory access-token cache, one entry per connection (spec: "Token in memory only, re-requested on
 * expiry or one 401"). Process-local by design: a serverless instance that recycles simply asks
 * again. Never persisted, never serialized (`AccessToken` redacts itself).
 */
export class AccessTokenCache {
  private readonly entries = new Map<string, AccessGrant>();

  constructor(private readonly clock: () => number = Date.now) {}

  get(connectionId: string): AccessToken | null {
    const entry = this.entries.get(connectionId);
    if (!entry) return null;
    if (this.clock() >= entry.expiresAtMs) {
      this.entries.delete(connectionId);
      return null;
    }
    return entry.token;
  }

  set(connectionId: string, grant: AccessGrant): void {
    this.entries.set(connectionId, grant);
  }

  /** After a 401 from the FHIR server: drop the token so the next call requests a new one. */
  invalidate(connectionId: string): void {
    this.entries.delete(connectionId);
  }
}
