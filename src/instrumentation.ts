import type { Instrumentation } from "next";
import { serverEnv } from "@/lib/env";
import { log } from "@/lib/log";
import { requestErrorFields } from "@/lib/request-error";

// Runs once when the server starts: refuse to boot with missing or invalid configuration.
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    serverEnv();
  }
}

/**
 * One structured record per unhandled server error: route, digest, error name and SQLSTATE only.
 * Next.js still logs the error itself, so messages are made PHI-free at the source
 * (`sanitizeDatabaseError`, src/db/tenant.ts).
 */
export const onRequestError: Instrumentation.onRequestError = (error, _request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  log.error("request.unhandled_error", requestErrorFields(error, context));
};
