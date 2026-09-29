// The building blocks of the sync's code vocabulary (docs/specs/patient-integrations.md "PI2b", "Sync
// run and issue codes"). A leaf module with no imports, so the mapper, the search layer and the domain
// can all use it. The **allow-lists the database is written from** are assembled in
// `src/domain/integrations/sync-codes.ts` (`SYNC_RUN_CODES`, `SYNC_ISSUE_CODES`); this file is where
// each family is defined.
//
// Rules, because the sync-history page shows these codes as raw strings on a page that is not audited
// (it is meant to contain no PHI): a code is lower-case snake_case (`^[a-z_]{1,64}$`, the CHECKs on
// `integration_sync_runs.issue_codes` and `integration_sync_issues.code`), it is defined here in code and
// never built from anything a server sent, and **a code attached to a patient row never names a
// sensitivity, restriction, minor or Part 2 category** (coordinator, 2026-09-28): the neutral
// `review_required` stands in for "an administrator should look at this patient".

/** A record skipped by a required mapping rule (an issue row, and the run's `skipped_count`). */
export const SKIP_CODES = [
  "resource_invalid",
  "id_invalid",
  "mrn_missing",
  "mrn_ambiguous",
  "mrn_invalid",
  "mrn_government_identifier",
  "mrn_looks_like_ssn",
  "mrn_looks_like_mbi",
  "name_incomplete",
  "name_invalid",
  "birthdate_incomplete",
  "birthdate_invalid",
] as const;

/**
 * A record stored, with a note for the administrator (an issue row; not counted as skipped).
 * `review_required` is deliberately neutral: it is what tells an administrator that a newly synced
 * patient needs a look at their tags (the suggested "minor" tag, spec "Field mapping"), without the
 * history page naming why.
 */
export const NOTE_CODES = ["address_incomplete", "review_required"] as const;

/** Matching found something that stops a record being stored (an issue row naming the other patient). */
export const CONFLICT_CODES = ["mrn_conflict"] as const;

/** Run-level notices that are not about one record. */
export const RUN_NOTICE_CODES = ["issues_truncated"] as const;

/** Anything a server sent that isn't in our vocabulary is stored as this, never verbatim. */
export const OTHER_CODE = "other" as const;

/** Transport-level failures (`errors.ts`), which end a run. */
export const TRANSPORT_FAILURE_CODES = [
  "unreachable",
  "tls_failed",
  "address_refused",
  "redirect_refused",
  "content_type_refused",
  "too_large",
  "timeout",
  "paging_loop",
] as const;

/** Why a run failed (the run's `issue_codes`, with the audit event's `code`). */
export const RUN_FAILURE_CODES = [
  ...TRANSPORT_FAILURE_CODES,
  "auth_refused",
  "bad_response",
  "capability_missing",
  "smart_config_invalid",
  "not_fhir",
  "issuer_mismatch",
  "token_endpoint_changed",
  "not_synthetic",
  "environment_refused",
  "signing_key_unavailable",
  "connection_not_active",
  "internal_error",
] as const;

/**
 * R4 `OperationOutcome.issue.code` (IssueType, https://hl7.org/fhir/R4/valueset-issue-type.html) as
 * stored: hyphens become underscores, because the CHECKs allow none (`not-found` -> `not_found`).
 * `timeout` is in `TRANSPORT_FAILURE_CODES` already. This list is our copy, in code; a code that isn't
 * on it is stored as `other`.
 */
export const R4_ISSUE_TYPE_RUN_CODES = [
  "invalid",
  "structure",
  "required",
  "value",
  "invariant",
  "security",
  "login",
  "unknown",
  "expired",
  "forbidden",
  "suppressed",
  "processing",
  "not_supported",
  "duplicate",
  "multiple_matches",
  "not_found",
  "deleted",
  "too_long",
  "code_invalid",
  "extension",
  "too_costly",
  "business_rule",
  "conflict",
  "transient",
  "lock_error",
  "no_store",
  "exception",
  "incomplete",
  "throttled",
  "informational",
] as const;

const R4_BY_REMOTE_SPELLING: ReadonlyMap<string, string> = new Map(
  [...R4_ISSUE_TYPE_RUN_CODES, "timeout"].map((code) => [code.replaceAll("_", "-"), code]),
);

/**
 * The stored code for a remote `OperationOutcome.issue.code`: ours if it is exactly an R4 IssueType
 * code (hyphenated, as the standard spells it), else `other`. Never the remote string.
 */
export function runCodeForIssueType(remote: string | undefined): string {
  return (remote !== undefined ? R4_BY_REMOTE_SPELLING.get(remote) : undefined) ?? OTHER_CODE;
}

export type SkipCode = (typeof SKIP_CODES)[number];
export type NoteCode = (typeof NOTE_CODES)[number];
export type SyncFailureCode = (typeof RUN_FAILURE_CODES)[number];
