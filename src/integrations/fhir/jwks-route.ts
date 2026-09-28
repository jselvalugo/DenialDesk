import { syntheticDataOnly } from "@/lib/env";
import type { RateLimitResult } from "@/lib/rate-limit";
import {
  getSigningKeyStore,
  jwksDocument,
  pickPublicJwkFields,
  SigningKeyStoreError,
  type SigningKeyStore,
} from "./keys";

// The pre-production JWKS (docs/specs/patient-integrations.md PI2a "JWKS routes"): the one shared
// signing key's public half at `/.well-known/jwks.json`, so the practice's EHR/PM administrator can
// register it. Public data (spec "Classification"), but still: allow-listed fields only, its own
// rate-limit bucket, and 404 for anything that isn't a published key. No database read.

export interface JwksRouteDeps {
  /** Records one hit for the caller in the `jwks` bucket. */
  limit(): Promise<RateLimitResult>;
  store?: () => SigningKeyStore;
  synthetic?: () => boolean;
}

const notFound = () =>
  new Response(null, {
    status: 404,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });

export async function handleJwksRequest(deps: JwksRouteDeps): Promise<Response> {
  const limited = await deps.limit();
  if (!limited.allowed) {
    return new Response(null, {
      status: 429,
      headers: { "retry-after": String(Math.max(1, limited.retryAfterSeconds)), "cache-control": "no-store" },
    });
  }
  // Where real data is allowed there is no shared key: keys are per connection, in Key Vault, at
  // `/.well-known/jwks/<connection-uuid>.json` (Azure cutover). Nothing is published here.
  if (!(deps.synthetic ?? syntheticDataOnly)()) return notFound();

  let keys;
  try {
    keys = await (deps.store ?? getSigningKeyStore)().publicJwks("shared");
  } catch (error) {
    // Not configured or unreadable looks the same as unknown: no oracle on the deployment's state.
    if (error instanceof SigningKeyStoreError) return notFound();
    throw error;
  }
  // Last line of defence: re-apply the allow-list to whatever the adapter returned.
  const published = keys.map((key) => pickPublicJwkFields(key as unknown as Record<string, unknown>));
  return new Response(JSON.stringify(jwksDocument(published as never)), {
    status: 200,
    headers: {
      "content-type": "application/jwk-set+json",
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
