import type { Instrumentation } from "next";
import { serverEnv } from "@/lib/env";

// Node-only modules (the logger writes to process.stderr; the sanitizer patches Drizzle) are
// imported inside the runtime check, so the Edge instrumentation bundle never includes them.

// Runs once when the server starts: refuse to boot with missing or invalid configuration.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    serverEnv();
    // Production refuses to start integrations with an environment signing key present (spec PI2a
    // "Keys", R-7.3.5: Key Vault only). Throwing here fails the boot; the security event and log
    // line carry no value.
    const { assertNoEnvSigningKeyInProduction, SigningKeyStoreError } =
      await import("@/integrations/fhir/keys");
    try {
      assertNoEnvSigningKeyInProduction();
    } catch (error) {
      if (error instanceof SigningKeyStoreError) {
        const { log } = await import("@/lib/log");
        log.error("integrations.env_signing_key_in_production");
        try {
          const { auditSystem } = await import("@/lib/audit");
          await auditSystem({ action: "security.env_signing_key_in_production", reason: "startup" });
        } catch {
          // The database may not be reachable this early; the refusal below is what matters.
        }
      }
      throw error;
    }
    // Where real data is allowed and background jobs are not fully configured, Sync now refuses every press
    // (ADR 0012, security review L4): say so once at boot. A code only.
    const { logJobsConfigAtBoot } = await import("@/integrations/jobs/default-sender");
    logJobsConfigAtBoot();
    // Fails the boot if a Drizzle upgrade removed the method errors are sanitized in (ADR 0006).
    const { installQueryErrorSanitizer } = await import("@/db/errors");
    installQueryErrorSanitizer();
  }
}

/**
 * One structured record per unhandled server error: route, digest, error name and SQLSTATE only.
 * Next.js still logs the error itself, so its message must be PHI-free where it is thrown. Every
 * database error is sanitized where Drizzle creates it (src/db/errors.ts, ADR 0006).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ log }, { requestErrorFields }] = await Promise.all([
    import("@/lib/log"),
    import("@/lib/request-error"),
  ]);
  log.error("request.unhandled_error", requestErrorFields(error, context));
};
