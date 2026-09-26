import type { Tone } from "@/components/ui/Badge";
import type { denialStatusEnum } from "@/db/schema";

export type DenialStatus = (typeof denialStatusEnum.enumValues)[number];

/**
 * `open`: still in the queue. `awaitingAction`: the practice still has to act before the appeal
 * deadline. Once an appeal is submitted the deadline has been met; the denial stays open while
 * the payer decides, but it is no longer at risk of missing the deadline.
 */
export const DENIAL_STATUSES: Record<
  DenialStatus,
  { label: string; tone: Tone; open: boolean; awaitingAction: boolean }
> = {
  new: { label: "New", tone: "neutral", open: true, awaitingAction: true },
  in_review: { label: "In review", tone: "info", open: true, awaitingAction: true },
  needs_records: { label: "Needs records", tone: "warning", open: true, awaitingAction: true },
  appeal_drafted: { label: "Appeal drafted", tone: "info", open: true, awaitingAction: true },
  appeal_submitted: { label: "Appeal submitted", tone: "info", open: true, awaitingAction: false },
  overturned: { label: "Overturned", tone: "success", open: false, awaitingAction: false },
  upheld: { label: "Upheld", tone: "danger", open: false, awaitingAction: false },
  written_off: { label: "Written off", tone: "neutral", open: false, awaitingAction: false },
  closed: { label: "Closed", tone: "neutral", open: false, awaitingAction: false },
};

const statuses = Object.keys(DENIAL_STATUSES) as DenialStatus[];
export const OPEN_STATUSES = statuses.filter((s) => DENIAL_STATUSES[s].open);
export const ACTION_STATUSES = statuses.filter((s) => DENIAL_STATUSES[s].awaitingAction);

export const REGIME_LABELS: Record<string, string> = {
  fl_insurer: "FL commercial",
  fl_hmo: "FL HMO",
  erisa_self_funded: "Self-funded ERISA",
  medicare: "Medicare",
  medicare_advantage: "Medicare Advantage",
  medicaid_ffs: "Medicaid FFS",
  smmc: "Medicaid managed care",
  workers_comp: "Workers' comp",
  pip: "PIP",
};

/**
 * A payer's regulatory regime is null until it is verified against the clearinghouse payer list
 * (P2, spec: payer-catalog). Anywhere a regime label is shown, null must read as "not verified"
 * rather than throwing or showing "undefined".
 */
export function regimeLabel(regime: string | null): string {
  if (regime === null) return "Regime not verified";
  return REGIME_LABELS[regime] ?? regime;
}
