import { z } from "zod";
import { PATIENT_SORT_DEFAULT_DIR, PATIENT_SORT_KEYS, type PatientSortKey } from "@/domain/patients/queries";

export type SortDir = "asc" | "desc";

const schema = z.object({
  sort: z.enum(PATIENT_SORT_KEYS).catch("name"),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
});

/**
 * Parses the list's `sort`/`dir` query params (page number is parsed separately in `page.tsx`; the
 * search term itself is never in the URL, CLAUDE.md #4). An unknown sort key or direction falls back
 * to a safe default.
 */
export function parsePatientSort(params: Record<string, string | string[] | undefined>): {
  sort: PatientSortKey;
  dir: SortDir;
} {
  const flat = {
    sort: Array.isArray(params.sort) ? params.sort[0] : params.sort,
    dir: Array.isArray(params.dir) ? params.dir[0] : params.dir,
  };
  const parsed = schema.parse(flat);
  return { sort: parsed.sort, dir: parsed.dir ?? PATIENT_SORT_DEFAULT_DIR[parsed.sort] };
}

/** Builds `/patients` with `sort`/`dir`/`page`, omitting each when it's already the default. */
export function patientListHref(sort: PatientSortKey, dir: SortDir, page: number): string {
  const query = new URLSearchParams();
  if (sort !== "name") query.set("sort", sort);
  if (dir !== PATIENT_SORT_DEFAULT_DIR[sort]) query.set("dir", dir);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `/patients?${text}` : "/patients";
}
