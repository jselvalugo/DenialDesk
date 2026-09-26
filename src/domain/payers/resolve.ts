/**
 * Resolves the free text typed into the Payer picker (`PatientForm.tsx`) to a payer, without any
 * DOM or React dependency so it can be unit-tested directly (spec: payer-catalog P1).
 */
export interface PayerOption {
  id: string;
  name: string;
  verified: boolean;
}

export type PayerResolution =
  { status: "self_pay" } | { status: "matched"; payer: PayerOption } | { status: "unmatched" };

/**
 * Empty (after trimming) resolves to self-pay. Non-empty text is matched against payer names,
 * case-insensitively and trimmed on both sides (so trailing whitespace never silently mismatches).
 * Text matching no payer resolves to "unmatched" — callers must treat that as a blocking field
 * error, never as self-pay. When more than one payer shares a name, the verified one wins, so a
 * practice's own verified entry is preferred over an unverified catalog stub of the same name.
 */
export function resolvePayerByName(payers: PayerOption[], text: string): PayerResolution {
  const trimmed = text.trim();
  if (trimmed === "") return { status: "self_pay" };
  const key = trimmed.toLowerCase();
  const matches = payers.filter((p) => p.name.trim().toLowerCase() === key);
  if (matches.length === 0) return { status: "unmatched" };
  const payer = matches.find((p) => p.verified) ?? matches[0]!;
  return { status: "matched", payer };
}
