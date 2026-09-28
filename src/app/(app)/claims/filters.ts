import { z } from "zod";
import { CLAIM_SORT_DEFAULT_DIR, CLAIM_SORT_KEYS, type ClaimFilters } from "@/domain/claims/queries";

const schema = z.object({
  group: z.enum(["unsubmitted", "in_process", "all"]).catch("unsubmitted"),
  payer: z.uuid().optional().catch(undefined),
  filing: z
    .enum(["due_soon", "past_deadline", "not_configured", "payer_unverified"])
    .optional()
    .catch(undefined),
  sort: z.enum(CLAIM_SORT_KEYS).optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/**
 * Parses untrusted query params; an unknown sort key or direction falls back to a safe default.
 * `sort` is left `undefined` (not defaulted to a column) so the group keeps its own priority order
 * — filing urgency for unsubmitted claims, newest service date first otherwise — until the biller
 * explicitly clicks a column header.
 */
export function parseClaimFilters(params: Record<string, string | string[] | undefined>): ClaimFilters {
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]),
  );
  const parsed = schema.parse(flat);
  return {
    group: parsed.group,
    payerId: parsed.payer,
    // Filing risk only applies to claims not yet accepted by the payer.
    filing: parsed.group === "unsubmitted" ? parsed.filing : undefined,
    sort: parsed.sort,
    dir: parsed.sort ? (parsed.dir ?? CLAIM_SORT_DEFAULT_DIR[parsed.sort]) : undefined,
    page: parsed.page,
  };
}

export function claimFiltersToQuery(filters: ClaimFilters, overrides: Partial<ClaimFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (merged.group !== "unsubmitted") query.set("group", merged.group);
  if (merged.payerId) query.set("payer", merged.payerId);
  if (merged.filing) query.set("filing", merged.filing);
  if (merged.sort) {
    query.set("sort", merged.sort);
    const dir = merged.dir ?? CLAIM_SORT_DEFAULT_DIR[merged.sort];
    if (dir !== CLAIM_SORT_DEFAULT_DIR[merged.sort]) query.set("dir", dir);
  }
  if (merged.page > 1) query.set("page", String(merged.page));
  const text = query.toString();
  return text ? `?${text}` : "";
}
