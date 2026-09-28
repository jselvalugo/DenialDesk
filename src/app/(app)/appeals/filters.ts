import { z } from "zod";
import { appealLevelEnum } from "@/db/schema";
import {
  APPEAL_SORT_DEFAULT_DIR,
  type AppealQueueFilters,
  type AppealSortKey,
} from "@/domain/appeals/queries";

const schema = z.object({
  status: z.enum(["open", "closed", "all"]).catch("open"),
  payer: z.uuid().optional().catch(undefined),
  level: z.enum(appealLevelEnum.enumValues).optional().catch(undefined),
  sort: z.enum(["deadline", "amount"]).catch("deadline"),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/** Parses untrusted query params; an unknown sort key or direction falls back to a safe default. */
export function parseAppealFilters(
  params: Record<string, string | string[] | undefined>,
): AppealQueueFilters {
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]),
  );
  const parsed = schema.parse(flat);
  const sort: AppealSortKey = parsed.sort;
  return {
    status: parsed.status,
    payerId: parsed.payer,
    level: parsed.level,
    sort,
    dir: parsed.dir ?? APPEAL_SORT_DEFAULT_DIR[sort],
    page: parsed.page,
  };
}

export function appealFiltersToQuery(
  filters: AppealQueueFilters,
  overrides: Partial<AppealQueueFilters> = {},
): string {
  const merged = { ...filters, ...overrides };
  const dir = merged.dir ?? APPEAL_SORT_DEFAULT_DIR[merged.sort];
  const query = new URLSearchParams();
  if (merged.status !== "open") query.set("status", merged.status);
  if (merged.payerId) query.set("payer", merged.payerId);
  if (merged.level) query.set("level", merged.level);
  if (merged.sort !== "deadline") query.set("sort", merged.sort);
  if (dir !== APPEAL_SORT_DEFAULT_DIR[merged.sort]) query.set("dir", dir);
  if (merged.page > 1) query.set("page", String(merged.page));
  const text = query.toString();
  return text ? `?${text}` : "";
}
