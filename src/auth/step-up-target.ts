import { safeInternalPath } from "@/lib/safe-path";

// Where a step-up (R-7.2.2) may send the browser back to, and how that destination is described in
// the audit log. `returnTo` arrives from a query string or a form field, so it is untrusted:
// it is length-capped, run through `safeInternalPath`, and then must be one of the few pages that
// start a step-up. Only a route template and, when there is one, a UUID reach the audit log
// (never the raw path, so free text in a crafted URL can't be written to it).

/** A `returnTo` longer than this is refused outright, before any parsing. */
export const MAX_RETURN_TO_LENGTH = 256;

export const STEP_UP_DEFAULT_PATH = "/settings/integrations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StepUpTarget {
  /** Where to send the browser afterwards: a pathname on this site, no query string. */
  path: string;
  /** The page's route template, for the audit log (`/settings/integrations/[id]`, `.../[id]/payers`). */
  route: string;
  /** The connection's (or provider's) UUID (lowercased) when the page is one record's, else null. */
  routeId: string | null;
}

const DEFAULT_TARGET: StepUpTarget = {
  path: STEP_UP_DEFAULT_PATH,
  route: STEP_UP_DEFAULT_PATH,
  routeId: null,
};

/**
 * Resolves an untrusted `returnTo`. Anything that isn't `/settings/integrations`,
 * `/settings/integrations/new`, `/settings/integrations/<uuid>`, or the payer mapping page
 * `/settings/integrations/<uuid>/payers` (PI2b: saving a mapping needs a step-up), or
 * `/settings/billing/providers/<uuid>` (claims C3a-S: setting a TIN needs a step-up), including a
 * non-UUID id segment, an over-long value, or any off-site or malformed path, resolves to the
 * default page. A query string or fragment is dropped.
 */
export function stepUpTarget(value: unknown): StepUpTarget {
  if (typeof value !== "string" || value.length > MAX_RETURN_TO_LENGTH) return DEFAULT_TARGET;
  const safe = safeInternalPath(value, "");
  if (safe === "") return DEFAULT_TARGET;
  const pathname = safe.split("?")[0]!;
  if (pathname === STEP_UP_DEFAULT_PATH || pathname === `${STEP_UP_DEFAULT_PATH}/new`) {
    return { path: pathname, route: pathname, routeId: null };
  }
  const match = /^\/settings\/integrations\/([^/]+)(\/payers)?$/.exec(pathname);
  if (match && UUID.test(match[1]!)) {
    const id = match[1]!.toLowerCase();
    const sub = match[2] ?? "";
    return {
      path: `${STEP_UP_DEFAULT_PATH}/${id}${sub}`,
      route: `${STEP_UP_DEFAULT_PATH}/[id]${sub}`,
      routeId: id,
    };
  }
  // Provider billing details (docs/specs/claims.md C3a-S): setting a TIN needs a step-up.
  const billing = /^\/settings\/billing\/providers\/([^/]+)$/.exec(pathname);
  if (billing && UUID.test(billing[1]!)) {
    const id = billing[1]!.toLowerCase();
    return {
      path: `/settings/billing/providers/${id}`,
      route: "/settings/billing/providers/[id]",
      routeId: id,
    };
  }
  return DEFAULT_TARGET;
}
