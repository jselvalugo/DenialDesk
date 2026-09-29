import type { MessageKey } from "@/i18n/messages/types";

// The fixed vocabularies of sync run codes and issue codes (docs/specs/patient-integrations.md PI2b,
// "Sync history"; threat model I1). The sync history page shows a stored code only through these
// lists: a listed code is shown as its translated label (`runs.code.<code>`), and anything else,
// however it got into the table, as one generic "other" label, never as the raw string. The database
// CHECKs only bound the shape (`^[a-z_]{1,64}$`), so the page can't trust a stored code to be
// PHI-free: this allow-list is what guarantees it. Pure and self-contained (no `@/db/*` imports).
//
// **PHI-free by construction.** A code linked to a patient row (an issue) must not reveal what the
// EHR says *about* the patient beyond a data-quality defect: no sensitivity label (HIV, psychiatric,
// substance use, 42 CFR Part 2, ethnicity, domestic violence), no restriction (R/V), no minor status,
// no diagnosis or program. None of those is in these lists, and a unit test refuses any list entry
// that contains such a word. The sync engine must enforce the same on write (spec PI2b item).
//
// ⚠️ The lists start from the codes the spec names for PI2b (mapper skip codes, run-level failures,
// the Test connection outcomes, R4 IssueType codes). The R4 IssueType codes with a hyphen
// (`not-supported`, `code-invalid`, ...) can't be stored under the CHECK's shape; how the engine maps
// them is its own decision, and until they are listed here they show as "other".

/** Per-record codes: why a resource was skipped or linked. Each row can point at a DenialDesk patient. */
export const SYNC_ISSUE_CODES = [
  "mrn_missing",
  "mrn_ambiguous",
  "mrn_looks_like_ssn",
  "mrn_looks_like_mbi",
  "name_incomplete",
  "birthdate_incomplete",
  "address_incomplete",
  "mrn_conflict",
  "needs_review",
  "linked_to_source",
  // Added by the sync engine (PI2b part 1): the rest of the mapper's skip codes, and the neutral
  // note that stands in for "an administrator should look at this patient's tags" (never says why).
  "resource_invalid",
  "id_invalid",
  "mrn_invalid",
  "mrn_government_identifier",
  "name_invalid",
  "birthdate_invalid",
  "review_required",
  "other",
] as const;
export type SyncIssueCode = (typeof SYNC_ISSUE_CODES)[number];

/**
 * Run-level codes: why a run stopped or was degraded (never tied to a patient). Includes the Test
 * connection outcomes a run can hit again (except `not_fhir_r4`, whose digit the storage CHECK refuses), and the R4 `OperationOutcome.issue.code` values that fit
 * the CHECK's shape.
 */
export const SYNC_RUN_CODES = [
  "issuer_mismatch",
  "not_synthetic",
  "paging_loop",
  "token_endpoint_changed",
  "scope_insufficient",
  "invalid_client",
  "unreachable",
  "tls_failed",
  "smart_config_invalid",
  "auth_refused",
  "capability_missing",
  "internal_error",
  // Added by the sync engine (PI2b part 1). `not_fhir_r4` is stored as `not_fhir` (a digit fails the CHECK).
  "address_refused",
  "redirect_refused",
  "content_type_refused",
  "too_large",
  "bad_response",
  "not_fhir",
  "environment_refused",
  "signing_key_unavailable",
  "connection_not_active",
  "issues_truncated",
  "other",
  // R4 IssueType (https://hl7.org/fhir/R4/valueset-issue-type.html), the ones a run can record.
  "invalid",
  "security",
  "login",
  "forbidden",
  "expired",
  "processing",
  "duplicate",
  "conflict",
  "transient",
  "timeout",
  "throttled",
  "exception",
  "incomplete",
  "informational",
  "unknown",
  // The hyphenated R4 IssueType codes, stored with underscores (the CHECK allows no hyphen).
  "structure",
  "required",
  "value",
  "invariant",
  "suppressed",
  "not_supported",
  "multiple_matches",
  "not_found",
  "deleted",
  "too_long",
  "code_invalid",
  "extension",
  "too_costly",
  "business_rule",
  "lock_error",
  "no_store",
] as const;
export type SyncRunCode = (typeof SYNC_RUN_CODES)[number];

const issueCodes: readonly string[] = SYNC_ISSUE_CODES;
const runCodes: readonly string[] = SYNC_RUN_CODES;

export const isSyncIssueCode = (value: unknown): value is SyncIssueCode =>
  typeof value === "string" && issueCodes.includes(value);
export const isSyncRunCode = (value: unknown): value is SyncRunCode =>
  typeof value === "string" && runCodes.includes(value);

type CodeKey = `runs.code.${SyncIssueCode | SyncRunCode}`;
/** The label used for any code that isn't listed. */
export const SYNC_CODE_OTHER_KEY = "runs.code.other" as const satisfies MessageKey<"integrations">;

/**
 * The message key (`integrations` namespace) to show for a stored issue code: its own label if listed,
 * else the generic "other". Never the stored string.
 */
export function issueCodeLabelKey(code: string): MessageKey<"integrations"> {
  return isSyncIssueCode(code) ? (`runs.code.${code}` satisfies CodeKey) : SYNC_CODE_OTHER_KEY;
}

/**
 * The message key for a code in a run's `issue_codes` column. A run aggregates its own failure codes
 * and the per-record issue codes, so either list counts; anything else is "other".
 */
export function runCodeLabelKey(code: string): MessageKey<"integrations"> {
  return isSyncRunCode(code) || isSyncIssueCode(code)
    ? (`runs.code.${code}` satisfies CodeKey)
    : SYNC_CODE_OTHER_KEY;
}

/** A run's stored codes as the distinct message keys to show, listed codes first in stored order, "other" once, last. */
export function runCodeLabelKeys(codes: readonly string[]): MessageKey<"integrations">[] {
  const keys: MessageKey<"integrations">[] = [];
  for (const code of codes) {
    const key = runCodeLabelKey(code);
    if (!keys.includes(key)) keys.push(key);
  }
  const other = keys.indexOf(SYNC_CODE_OTHER_KEY);
  if (other !== -1 && other !== keys.length - 1) {
    keys.splice(other, 1);
    keys.push(SYNC_CODE_OTHER_KEY);
  }
  return keys;
}

/** The code to store on an issue row: itself if allowed, else `other`. Nothing from a server is stored verbatim. */
export function normalizeIssueCode(code: string): SyncIssueCode {
  return isSyncIssueCode(code) ? code : "other";
}

/**
 * The codes to store on a run: each allowed one once (a run aggregates its failure codes and the
 * per-record issue codes, so either list counts), anything else as `other`, in a stable order.
 */
export function normalizeRunCodes(codes: Iterable<string>): SyncStoredCode[] {
  const allowed = new Set<SyncStoredCode>();
  for (const code of codes) {
    allowed.add(isSyncRunCode(code) || isSyncIssueCode(code) ? code : "other");
  }
  return [...allowed].sort();
}

/** Any code a run's `issue_codes` may hold: a run-level code or a per-record issue code. */
export type SyncStoredCode = SyncRunCode | SyncIssueCode;

export const isSyncStoredCode = (value: unknown): value is SyncStoredCode =>
  isSyncRunCode(value) || isSyncIssueCode(value);
