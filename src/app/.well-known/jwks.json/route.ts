import { handleJwksRequest } from "@/integrations/fhir/jwks-route";
import { limitCurrentRequest } from "@/lib/rate-limit";

// Public, unauthenticated, read-only (docs/specs/patient-integrations.md PI2a "JWKS routes"). Never
// cached by the framework: the rate limit reads the request, and the key can change at rotation.
export const dynamic = "force-dynamic";

export function GET(): Promise<Response> {
  return handleJwksRequest({ limit: () => limitCurrentRequest("jwks") });
}
