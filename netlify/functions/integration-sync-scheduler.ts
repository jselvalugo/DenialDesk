// Netlify Scheduled Function: every 15 minutes (OA-056) it queues a run for each due active connection
// and posts one signed job per run ID to the background function. Runs on the published (production)
// deploy only, never a deploy preview; Sync now still works on a preview. Thin on purpose: see
// src/platform/netlify/job-handlers.ts and ADR 0012. Netlify reads `config` statically, so it stays a literal here.
import { scheduledSyncFunction } from "../../src/platform/netlify/job-handlers";

const handler = async (): Promise<Response> => scheduledSyncFunction();

export default handler;

export const config = { schedule: "*/15 * * * *" };
