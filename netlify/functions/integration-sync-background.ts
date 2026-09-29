// Netlify Background Function (the `-background` suffix; up to 15 minutes, answers 202 at once): runs
// one signed sync job. Thin on purpose: all logic is in src/platform/netlify/job-handlers.ts and
// src/integrations/jobs (ADR 0003, ADR 0012). Invoked only with a valid HMAC by Sync now and the
// scheduled function; an unsigned call is refused. Pre-production, synthetic data only.
import { syncJobFunction } from "../../src/platform/netlify/job-handlers";

const handler = async (request: Request): Promise<Response> => syncJobFunction(request);

export default handler;
