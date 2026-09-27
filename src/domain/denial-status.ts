import type { Tone } from "@/components/ui/Badge";
import type { denialStatusEnum } from "@/db/schema";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";

type CommonKey = MessageKey<"common">;
type CommonT = Translator<Messages["common"]>;

export type DenialStatus = (typeof denialStatusEnum.enumValues)[number];

/**
 * `open`: still in the queue. `awaitingAction`: the practice still has to act before the appeal
 * deadline. Once an appeal is submitted the deadline has been met; the denial stays open while
 * the payer decides, but it is no longer at risk of missing the deadline.
 */
export const DENIAL_STATUSES: Record<
  DenialStatus,
  { labelKey: CommonKey; tone: Tone; open: boolean; awaitingAction: boolean }
> = {
  new: { labelKey: "denialStatus.new", tone: "neutral", open: true, awaitingAction: true },
  in_review: { labelKey: "denialStatus.in_review", tone: "info", open: true, awaitingAction: true },
  needs_records: {
    labelKey: "denialStatus.needs_records",
    tone: "warning",
    open: true,
    awaitingAction: true,
  },
  appeal_drafted: { labelKey: "denialStatus.appeal_drafted", tone: "info", open: true, awaitingAction: true },
  appeal_submitted: {
    labelKey: "denialStatus.appeal_submitted",
    tone: "info",
    open: true,
    awaitingAction: false,
  },
  overturned: { labelKey: "denialStatus.overturned", tone: "success", open: false, awaitingAction: false },
  upheld: { labelKey: "denialStatus.upheld", tone: "danger", open: false, awaitingAction: false },
  written_off: { labelKey: "denialStatus.written_off", tone: "neutral", open: false, awaitingAction: false },
  closed: { labelKey: "denialStatus.closed", tone: "neutral", open: false, awaitingAction: false },
};

/** The status name in the user's language: `denialStatusLabel(status, t)` with `t` from the common namespace. */
export function denialStatusLabel(status: DenialStatus, t: CommonT): string {
  return t(DENIAL_STATUSES[status].labelKey);
}

const statuses = Object.keys(DENIAL_STATUSES) as DenialStatus[];
export const OPEN_STATUSES = statuses.filter((s) => DENIAL_STATUSES[s].open);
export const ACTION_STATUSES = statuses.filter((s) => DENIAL_STATUSES[s].awaitingAction);

/**
 * The `appealSubmittedOn` value a status change should store. Every entry into
 * `appeal_submitted` re-stamps today's date, even a re-filing after the denial moved back out of
 * it: keeping the original date would show a late refiling as on time (F5, R-3.10.3). Any other
 * transition leaves the stored date untouched.
 */
export function nextAppealSubmittedOn(
  nextStatus: DenialStatus,
  current: string | null,
  today: string,
): string | null {
  return nextStatus === "appeal_submitted" ? today : current;
}

export const REGIME_LABEL_KEYS: Record<string, CommonKey> = {
  fl_insurer: "regime.fl_insurer",
  fl_hmo: "regime.fl_hmo",
  erisa_self_funded: "regime.erisa_self_funded",
  medicare: "regime.medicare",
  medicare_advantage: "regime.medicare_advantage",
  medicaid_ffs: "regime.medicaid_ffs",
  smmc: "regime.smmc",
  workers_comp: "regime.workers_comp",
  pip: "regime.pip",
};

/**
 * A payer's regulatory regime is null until it is verified against the clearinghouse payer list
 * (P2, spec: payer-catalog). Anywhere a regime label is shown, null must read as "not verified"
 * rather than throwing or showing "undefined". `t` is the common-namespace translator; an unknown
 * regime code is shown as-is.
 */
export function regimeLabel(regime: string | null, t: CommonT): string {
  if (regime === null) return t("regime.notVerified");
  const key = REGIME_LABEL_KEYS[regime];
  return key ? t(key) : regime;
}
