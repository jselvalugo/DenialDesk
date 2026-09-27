import type { Tone } from "@/components/ui/Badge";
import type { appealDecisionOutcomeEnum, appealStatusEnum, appealSubmittedMethodEnum } from "@/db/schema";
import type { MessageKey } from "@/i18n/messages/types";
import type { AppealLevel } from "./types";

type AppealKey = MessageKey<"appeals">;

export type AppealStatus = (typeof appealStatusEnum.enumValues)[number];
export type AppealSubmittedMethod = (typeof appealSubmittedMethodEnum.enumValues)[number];
export type AppealDecisionOutcome = (typeof appealDecisionOutcomeEnum.enumValues)[number];

export const APPEAL_STATUSES: Record<
  AppealStatus,
  { labelKey: AppealKey; tone: Tone; open: boolean; awaitingAction: boolean }
> = {
  draft: { labelKey: "status.draft", tone: "neutral", open: true, awaitingAction: true },
  in_review: { labelKey: "status.inReview", tone: "info", open: true, awaitingAction: true },
  ready: { labelKey: "status.ready", tone: "info", open: true, awaitingAction: true },
  submitted: { labelKey: "status.submitted", tone: "info", open: true, awaitingAction: false },
  awaiting_decision: {
    labelKey: "status.awaitingDecision",
    tone: "info",
    open: true,
    awaitingAction: false,
  },
  decided: { labelKey: "status.decided", tone: "success", open: false, awaitingAction: false },
  withdrawn: { labelKey: "status.withdrawn", tone: "neutral", open: false, awaitingAction: false },
  dismissed: { labelKey: "status.dismissed", tone: "neutral", open: false, awaitingAction: false },
};

const statuses = Object.keys(APPEAL_STATUSES) as AppealStatus[];
export const APPEAL_OPEN_STATUSES = statuses.filter((s) => APPEAL_STATUSES[s].open);
/** Statuses where the deadline still matters: not yet submitted (spec: deadline counts exclude submitted appeals). */
export const APPEAL_AWAITING_STATUSES = statuses.filter((s) => APPEAL_STATUSES[s].awaitingAction);

/** Message key (appeals namespace) for each appeal level's name; show it with `t(APPEAL_LEVEL_LABEL_KEYS[l])`. */
export const APPEAL_LEVEL_LABEL_KEYS: Record<AppealLevel, AppealKey> = {
  first_level: "level.firstLevel",
  second_level: "level.secondLevel",
  external_review: "level.externalReview",
  medicare_redetermination: "level.medicareRedetermination",
  medicare_qic: "level.medicareQic",
  medicare_alj: "level.medicareAlj",
  medicare_council: "level.medicareCouncil",
  medicare_federal_court: "level.medicareFederalCourt",
};

export const APPEAL_SUBMITTED_METHOD_LABEL_KEYS: Record<AppealSubmittedMethod, AppealKey> = {
  portal: "method.portal",
  fax: "method.fax",
  mail: "method.mail",
  electronic: "method.electronic",
};

export const APPEAL_DECISION_OUTCOME_LABEL_KEYS: Record<AppealDecisionOutcome, AppealKey> = {
  overturned_full: "outcome.overturnedFull",
  overturned_partial: "outcome.overturnedPartial",
  upheld: "outcome.upheld",
  withdrawn: "outcome.withdrawn",
  dismissed: "outcome.dismissed",
};

/**
 * Whether a submission met its deadline: the deadline day itself counts as on time (same boundary
 * rule as `denial-queue.md` / `rules/deadlines.ts#payerResponseStatus`). Null when there's no
 * deadline to compare against ("not configured"), since there's nothing to be late against.
 */
export function submissionTimeliness(
  submittedOn: string,
  deadline: string | null,
): "on_time" | "late" | null {
  if (deadline === null) return null;
  return submittedOn <= deadline ? "on_time" : "late";
}

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
