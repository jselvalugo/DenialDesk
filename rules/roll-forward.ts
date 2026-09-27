import type { Confirmation, Rule } from "./types";

/**
 * Whether weekend/holiday roll-forward governs deadlines (OA-023). Effective-dated like any rule:
 * after counsel confirms, close the current version (effectiveTo) and add one with
 * `confirmed: true` and `confirmedBy` recorded by a human. Only a human flips it.
 *
 * Owner decision 2026-09-27 (option 1), until confirmed: the date conservative for the practice
 * governs, i.e. the UNROLLED date for both sides —
 * - provider-side deadlines: file by the unrolled date (earlier, safer for the practice);
 * - payer-side deadlines: the payer is late (and interest starts) the day after the unrolled date.
 * The rolled date is still computed and shown as informational ("pending counsel").
 */
export interface RollForwardPolicy {
  confirmed: boolean;
  confirmedBy: Confirmation | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export const ROLL_FORWARD_POLICY: RollForwardPolicy[] = [
  { confirmed: false, confirmedBy: null, effectiveFrom: null, effectiveTo: null },
];

/** Whether roll-forward governs deadlines whose last day falls on `asOf` (YYYY-MM-DD). */
export function rollForwardConfirmed(
  asOf: string,
  policy: RollForwardPolicy[] = ROLL_FORWARD_POLICY,
): boolean {
  const match = policy.find(
    (p) =>
      (p.effectiveFrom === null || p.effectiveFrom <= asOf) &&
      (p.effectiveTo === null || asOf < p.effectiveTo),
  );
  if (!match) throw new Error(`No roll-forward policy in force on ${asOf}`);
  return match.confirmed && match.confirmedBy !== null;
}

/** Label for the rolled date while counsel has not confirmed it, by rule side. */
export function pendingRollLabel(side: Rule["side"]): string {
  return side === "payer" ? "informational, pending counsel" : "pending counsel";
}
