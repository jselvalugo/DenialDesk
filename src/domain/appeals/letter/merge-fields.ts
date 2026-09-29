import { createHash } from "node:crypto";
import type { MessageKey } from "@/i18n/messages/types";

// Appeal letter merge fields (docs/specs/appeals.md A2). A letter body stores tokens like
// `{{claim.number}}`; values are filled in only when the letter is shown or printed, so a saved letter
// holds no copy of a patient's name, birth date, or member ID (HC-3.4). This module is pure.

export const MERGE_FIELDS = {
  "patient.fullName": { labelKey: "letter.field.patientFullName" },
  "patient.birthDate": { labelKey: "letter.field.patientBirthDate" },
  "patient.memberIdMasked": { labelKey: "letter.field.patientMemberIdMasked" },
  "claim.number": { labelKey: "letter.field.claimNumber" },
  "claim.serviceDate": { labelKey: "letter.field.claimServiceDate" },
  "claim.billedAmount": { labelKey: "letter.field.claimBilledAmount" },
  "denial.carc": { labelKey: "letter.field.denialCarc" },
  "denial.carcDescription": { labelKey: "letter.field.denialCarcDescription" },
  "denial.rarcs": { labelKey: "letter.field.denialRarcs" },
  "denial.category": { labelKey: "letter.field.denialCategory" },
  "denial.amount": { labelKey: "letter.field.denialAmount" },
  "denial.noticeDate": { labelKey: "letter.field.denialNoticeDate" },
  "payer.name": { labelKey: "letter.field.payerName" },
  "provider.name": { labelKey: "letter.field.providerName" },
  "provider.npi": { labelKey: "letter.field.providerNpi" },
  "practice.name": { labelKey: "letter.field.practiceName" },
  "practice.city": { labelKey: "letter.field.practiceCity" },
  "appeal.deadline": { labelKey: "letter.field.appealDeadline" },
  "letter.date": { labelKey: "letter.field.letterDate" },
} as const satisfies Record<string, { labelKey: MessageKey<"appeals"> }>;

export type MergeFieldKey = keyof typeof MERGE_FIELDS;
export const MERGE_FIELD_KEYS = Object.keys(MERGE_FIELDS) as MergeFieldKey[];

/** Resolved values for one appeal; `null` means the record has no value ("not on file"). */
export type MergeValues = Record<MergeFieldKey, string | null>;

/** Shown in place of a value the record does not have, so the reviewer sees the gap. */
export const MISSING_VALUE = "[not on file]";

/** Same cap as the database CHECK on the template and version tables. */
export const MAX_LETTER_CHARS = 20000;

const TOKEN = /\{\{([^{}]*)\}\}/g;

export function isMergeFieldKey(name: string): name is MergeFieldKey {
  return Object.hasOwn(MERGE_FIELDS, name);
}

/** Offset in `body` of the first `{` or `}` outside a well-formed token, or -1. */
function firstStrayBrace(body: string): number {
  let from = 0;
  for (const match of body.matchAll(TOKEN)) {
    const gap = body.slice(from, match.index).search(/[{}]/);
    if (gap >= 0) return from + gap;
    from = match.index + match[0].length;
  }
  const tail = body.slice(from).search(/[{}]/);
  return tail >= 0 ? from + tail : -1;
}

export type BodyCheck =
  | { ok: true }
  | { ok: false; reason: "empty" | "too_long" }
  | { ok: false; reason: "malformed"; token: string }
  | { ok: false; reason: "unknown"; unknown: string[] };

/**
 * Validates a template or letter body at save: only allow-listed fields, no stray braces. An
 * unknown field is refused, never passed through (the field names shown back are capped).
 */
export function checkBody(body: string): BodyCheck {
  if (body.trim().length === 0) return { ok: false, reason: "empty" };
  if (body.length > MAX_LETTER_CHARS) return { ok: false, reason: "too_long" };
  const unknown: string[] = [];
  for (const match of body.matchAll(TOKEN)) {
    const name = (match[1] ?? "").trim();
    if (!isMergeFieldKey(name) && !unknown.includes(name)) unknown.push(name);
  }
  if (unknown.length > 0) return { ok: false, reason: "unknown", unknown: unknown.slice(0, 5) };
  const stray = firstStrayBrace(body);
  // Names the offending text (a short piece of what the user typed, shown back to them only). The snippet
  // is cut from the original body, so it reads as typed, not with the valid tokens removed.
  if (stray >= 0)
    return { ok: false, reason: "malformed", token: body.slice(stray, stray + 30).split("\n")[0]! };
  return { ok: true };
}

/** The distinct allow-listed fields a body uses, in order of first use. */
export function fieldsUsed(body: string): MergeFieldKey[] {
  const used: MergeFieldKey[] = [];
  for (const match of body.matchAll(TOKEN)) {
    const name = (match[1] ?? "").trim();
    if (isMergeFieldKey(name) && !used.includes(name)) used.push(name);
  }
  return used;
}

/** Fields the body uses that have no value on record. */
export function missingFields(body: string, values: MergeValues): MergeFieldKey[] {
  return fieldsUsed(body).filter((key) => values[key] === null || values[key] === "");
}

/**
 * Fills a body with values in a single pass and returns plain text. A value that itself contains
 * `{{...}}` is not expanded, and nothing here produces HTML: the page shows the result as a React
 * text node, which escapes it (SC-B4.1). A token that is not allow-listed is left as written.
 */
export function renderLetter(body: string, values: MergeValues): string {
  return body.replace(TOKEN, (whole, raw: string) => {
    const name = raw.trim();
    if (!isMergeFieldKey(name)) return whole;
    const value = values[name];
    return value === null || value === "" ? MISSING_VALUE : value;
  });
}

/**
 * A bracketed VERIFY or FILL IN placeholder (`[⚠️ VERIFY: ...]`, `[FILL IN: ...]`) that a person still has
 * to replace before the letter can go out. Case-insensitive.
 */
const UNRESOLVED_PLACEHOLDER = /\[\s*(⚠️?\s*)?(VERIFY|FILL IN)\b/i;

export function hasUnresolvedPlaceholder(body: string): boolean {
  return UNRESOLVED_PLACEHOLDER.test(body);
}

/** SHA-256 (hex) of the rendered letter: what a reviewer attested to. */
export function letterDigest(rendered: string): string {
  return createHash("sha256").update(rendered, "utf8").digest("hex");
}

/**
 * Fail closed until sensitivity handling exists (OA-031, OA-091): a patient with any practice sensitivity tag,
 * any source sensitivity label, or a source restriction never gets a letter attested or exported.
 */
export function isSensitivePatient(patient: {
  sensitivityTags: readonly string[];
  sourceSensitivity: readonly string[];
  sourceRestricted: boolean;
}): boolean {
  return (
    patient.sensitivityTags.length > 0 || patient.sourceSensitivity.length > 0 || patient.sourceRestricted
  );
}
