import type { Instrumentation } from "next";
import { serverEnv } from "@/lib/env";

// Node-only modules (the logger writes to process.stderr; the sanitizer patches Drizzle) are
// imported inside the runtime check, so the Edge instrumentation bundle never includes them.

// Runs once when the server starts: refuse to boot with missing or invalid configuration.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    serverEnv();
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
