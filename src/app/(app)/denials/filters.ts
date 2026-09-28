import { z } from "zod";
import { denialCategoryEnum } from "@/db/schema";
import { QUEUE_SORT_DEFAULT_DIR, type QueueFilters, type QueueSortKey } from "@/domain/denials/queries";

const schema = z.object({
  status: z.enum(["open", "closed", "all"]).catch("open"),
  payer: z.uuid().optional().catch(undefined),
  category: z.enum(denialCategoryEnum.enumValues).optional().catch(undefined),
  assignee: z.enum(["me", "unassigned"]).optional().catch(undefined),
  sort: z.enum(["deadline", "amount", "notice"]).catch("deadline"),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).catch(1),
});

/** Parses untrusted query params; an unknown sort key or direction falls back to a safe default. */
export function parseFilters(params: Record<string, string | string[] | undefined>): QueueFilters {
  const flat = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]),
  );
  const parsed = schema.parse(flat);
  const sort: QueueSortKey = parsed.sort;
  return {
    status: parsed.status,
    payerId: parsed.payer,
    category: parsed.category,
    assignee: parsed.assignee,
    sort,
    dir: parsed.dir ?? QUEUE_SORT_DEFAULT_DIR[sort],
    page: parsed.page,
  };
}

export function filtersToQuery(filters: QueueFilters, overrides: Partial<QueueFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const dir = merged.dir ?? QUEUE_SORT_DEFAULT_DIR[merged.sort];
  const query = new URLSearchParams();
  if (merged.status !== "open") query.set("status", merged.status);
  if (merged.payerId) query.set("payer", merged.payerId);
  if (merged.category) query.set("category", merged.category);
  if (merged.assignee) query.set("assignee", merged.assignee);
  if (merged.sort !== "deadline") query.set("sort", merged.sort);
  if (dir !== QUEUE_SORT_DEFAULT_DIR[merged.sort]) query.set("dir", dir);
  if (merged.page > 1) query.set("page", String(merged.page));
  const text = query.toString();
  return text ? `?${text}` : "";
}
