// Source sensitivity labels -> our fixed vocabulary (docs/specs/patient-integrations.md "Field
// mapping", `source_restricted` / `source_sensitivity`; threat model I4; ADR 0010). A patient is
// restricted in the source when `Patient.meta.security` carries confidentiality `R` or `V`, an ActCode
// sensitivity code, or ANY label we don't recognize (fail toward masking). The stored codes are a
// fixed vocabulary, `unknown` standing for every unrecognized label, so nothing a server sends is
// stored verbatim. ⚠️ VERIFY the ActCode list (HIV, PSY, ETH, SDV, 42CFRPart2) with counsel and the
// v3-Confidentiality / v3-ActCode published value sets before the first real practice.

export const CONFIDENTIALITY_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-Confidentiality";
export const ACT_CODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode";

/** Must match the CHECK `patients_source_sensitivity_valid` (drizzle/0039). Order is the storage order. */
export const SENSITIVITY_VOCABULARY = [
  "R",
  "V",
  "HIV",
  "PSY",
  "ETH",
  "SDV",
  "42CFRPart2",
  "unknown",
] as const;
export type SensitivityCode = (typeof SENSITIVITY_VOCABULARY)[number];

/** v3-Confidentiality values that do not restrict (U unrestricted, L low, M moderate, N normal). */
const NON_RESTRICTING = new Set(["U", "L", "M", "N"]);
const RESTRICTING_CONFIDENTIALITY = new Set(["R", "V"]);
const ACT_CODE_SENSITIVITY = new Set(["HIV", "PSY", "ETH", "SDV", "42CFRPart2"]);

export interface SecurityCoding {
  system?: string;
  code?: string;
}

export interface LabelClassification {
  restricted: boolean;
  /** Distinct codes from `SENSITIVITY_VOCABULARY`, in vocabulary order; empty when nothing restricts. */
  sensitivity: SensitivityCode[];
}

function classifyOne(coding: SecurityCoding): SensitivityCode | null {
  const system = coding.system?.trim();
  const code = coding.code?.trim();
  if (system === CONFIDENTIALITY_SYSTEM && code) {
    if (RESTRICTING_CONFIDENTIALITY.has(code)) return code as SensitivityCode;
    if (NON_RESTRICTING.has(code)) return null;
  }
  if (system === ACT_CODE_SYSTEM && code && ACT_CODE_SENSITIVITY.has(code)) return code as SensitivityCode;
  // Anything else, including a recognized code under the wrong system, or no code at all.
  return "unknown";
}

/** Classifies `Patient.meta.security`. No labels at all is not restricted. */
export function classifySecurityLabels(security: readonly SecurityCoding[] | undefined): LabelClassification {
  const found = new Set<SensitivityCode>();
  for (const coding of security ?? []) {
    const classified = classifyOne(coding);
    if (classified) found.add(classified);
  }
  const sensitivity = SENSITIVITY_VOCABULARY.filter((code) => found.has(code));
  return { restricted: sensitivity.length > 0, sensitivity };
}
