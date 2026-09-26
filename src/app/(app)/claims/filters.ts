import { z } from "zod";
import type { ClaimFilters } from "@/domain/claims/queries";

const schema = z.object({
  group: z.enum(["unsubmitted", "in_process", "all"]).catch("unsubmitted"),
  payer: z.uuid().optional().catch(undefined),
  filing: z
    .enum(["due_soon", "past_deadline", "not_configured", "payer_unverified"])
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/** Parses untrusted query params; anything invalid falls back to a safe default. */
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
    page: parsed.page,
  };
}

export function claimFiltersToQuery(filters: ClaimFilters, overrides: Partial<ClaimFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const query = new URLSearchParams();
  if (merged.group !== "unsubmitted") query.set("group", merged.group);
  if (merged.payerId) query.set("payer", merged.payerId);
  if (merged.filing) query.set("filing", merged.filing);
  if (merged.page > 1) query.set("page", String(merged.page));
  const text = query.toString();
  return text ? `?${text}` : "";
}
