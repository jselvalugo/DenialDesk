import { z } from "zod";
import { PAYER_SORT_DEFAULT_DIR, PAYER_SORT_KEYS, type PayerSortKey } from "@/domain/payers/queries";

export type SortDir = "asc" | "desc";

const schema = z.object({
  sort: z.enum(PAYER_SORT_KEYS).catch("name"),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
});

/** Parses the list's `sort`/`dir` query params; an unknown key or direction falls back to a default. */
export function parsePayerSort(params: Record<string, string | string[] | undefined>): {
  sort: PayerSortKey;
  dir: SortDir;
} {
  const flat = {
    sort: Array.isArray(params.sort) ? params.sort[0] : params.sort,
    dir: Array.isArray(params.dir) ? params.dir[0] : params.dir,
  };
  const parsed = schema.parse(flat);
  return { sort: parsed.sort, dir: parsed.dir ?? PAYER_SORT_DEFAULT_DIR[parsed.sort] };
}

/** Builds `/settings/payers` with `sort`/`dir`, omitting each when it's already the default. */
export function payerListHref(sort: PayerSortKey, dir: SortDir): string {
  const query = new URLSearchParams();
  if (sort !== "name") query.set("sort", sort);
  if (dir !== PAYER_SORT_DEFAULT_DIR[sort]) query.set("dir", dir);
  const text = query.toString();
  return text ? `/settings/payers?${text}` : "/settings/payers";
}
