import type { Tone } from "@/components/ui/Badge";
import type { appealDecisionOutcomeEnum, appealStatusEnum, appealSubmittedMethodEnum } from "@/db/schema";

export type AppealStatus = (typeof appealStatusEnum.enumValues)[number];
export type AppealSubmittedMethod = (typeof appealSubmittedMethodEnum.enumValues)[number];
export type AppealDecisionOutcome = (typeof appealDecisionOutcomeEnum.enumValues)[number];

export const APPEAL_STATUSES: Record<
  AppealStatus,
  { label: string; tone: Tone; open: boolean; awaitingAction: boolean }
> = {
  draft: { label: "Draft", tone: "neutral", open: true, awaitingAction: true },
  in_review: { label: "In review", tone: "info", open: true, awaitingAction: true },
  ready: { label: "Ready", tone: "info", open: true, awaitingAction: true },
  submitted: { label: "Submitted", tone: "info", open: true, awaitingAction: false },
  awaiting_decision: { label: "Awaiting decision", tone: "info", open: true, awaitingAction: false },
  decided: { label: "Decided", tone: "success", open: false, awaitingAction: false },
  withdrawn: { label: "Withdrawn", tone: "neutral", open: false, awaitingAction: false },
  dismissed: { label: "Dismissed", tone: "neutral", open: false, awaitingAction: false },
};

const statuses = Object.keys(APPEAL_STATUSES) as AppealStatus[];
export const APPEAL_OPEN_STATUSES = statuses.filter((s) => APPEAL_STATUSES[s].open);
/** Statuses where the deadline still matters: not yet submitted (spec: deadline counts exclude submitted appeals). */
export const APPEAL_AWAITING_STATUSES = statuses.filter((s) => APPEAL_STATUSES[s].awaitingAction);

export const APPEAL_LEVEL_LABELS: Record<string, string> = {
  first_level: "First-level appeal",
  second_level: "Second-level appeal",
  external_review: "External review",
  medicare_redetermination: "Medicare redetermination",
  medicare_qic: "Medicare reconsideration (QIC)",
  medicare_alj: "Medicare ALJ hearing",
  medicare_council: "Medicare Appeals Council",
  medicare_federal_court: "Federal district court",
};

export const APPEAL_SUBMITTED_METHOD_LABELS: Record<AppealSubmittedMethod, string> = {
  portal: "Payer portal",
  fax: "Fax",
  mail: "Mail",
  electronic: "Electronic (clearinghouse)",
};

export const APPEAL_DECISION_OUTCOME_LABELS: Record<AppealDecisionOutcome, string> = {
  overturned_full: "Overturned in full",
  overturned_partial: "Partially overturned",
  upheld: "Upheld",
  withdrawn: "Withdrawn",
  dismissed: "Dismissed",
};

/** A decision outcome that is not a payer ruling on the merits (spec: appeals.md A1). */
export function isCloseOutcome(outcome: AppealDecisionOutcome): boolean {
  return outcome === "withdrawn" || outcome === "dismissed";
}

/** The denial status a decided appeal syncs to (spec: appeals.md A1 "Action: record decision"). */
export function denialStatusForDecision(outcome: AppealDecisionOutcome): "overturned" | "upheld" | "closed" {
  if (outcome === "overturned_full" || outcome === "overturned_partial") return "overturned";
  if (outcome === "upheld") return "upheld";
  return "closed";
}
