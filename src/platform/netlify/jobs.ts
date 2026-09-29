import { isAcceptableWorkerUrl } from "@/integrations/jobs/dispatch";

/** The Background Function's file name (netlify/functions/integration-sync-background.ts): the `-background` suffix is what makes it one. */
export const NETLIFY_WORKER_PATH = "/.netlify/functions/integration-sync-background";

/**
 * Where the signed jobs go on Netlify (pre-production only, ADR 0003): this deploy's own URL
 * (`DEPLOY_URL`, unique per deploy, so a deploy preview talks to its own worker and its own database
 * branch, never production's), else the site URL. Read from the platform's environment, never from a
 * request. `null` off Netlify or when the URL is not acceptable, so the caller falls back to running in the
 * request or refuses. `INTEGRATION_JOB_URL` overrides it (a local `netlify dev`, a test).
 */
export function netlifyWorkerUrl(env: Record<string, string | undefined> = process.env): string | null {
  const override = env.INTEGRATION_JOB_URL;
  if (override) return isAcceptableWorkerUrl(override) ? override : null;
  // The same signals `onNetlify()` reads (src/lib/env.ts), from the environment given.
  if (!(env.NETLIFY || env.NETLIFY_DB_URL || env.DEPLOY_ID || env.SITE_ID)) return null;
  const base = env.DEPLOY_URL || env.URL;
  if (!base) return null;
  const url = `${base.replace(/\/+$/, "")}${NETLIFY_WORKER_PATH}`;
  return isAcceptableWorkerUrl(url) ? url : null;
}
