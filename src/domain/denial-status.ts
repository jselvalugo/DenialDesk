import type { Tone } from "@/components/ui/Badge";
import type { denialStatusEnum } from "@/db/schema";

export type DenialStatus = (typeof denialStatusEnum.enumValues)[number];

export const DENIAL_STATUSES: Record<DenialStatus, { label: string; tone: Tone; open: boolean }> = {
  new: { label: "New", tone: "neutral", open: true },
  in_review: { label: "In review", tone: "info", open: true },
  needs_records: { label: "Needs records", tone: "warning", open: true },
  appeal_drafted: { label: "Appeal drafted", tone: "info", open: true },
  appeal_submitted: { label: "Appeal submitted", tone: "info", open: true },
  overturned: { label: "Overturned", tone: "success", open: false },
  upheld: { label: "Upheld", tone: "danger", open: false },
  written_off: { label: "Written off", tone: "neutral", open: false },
  closed: { label: "Closed", tone: "neutral", open: false },
};

export const OPEN_STATUSES = (Object.keys(DENIAL_STATUSES) as DenialStatus[]).filter(
  (s) => DENIAL_STATUSES[s].open,
);

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
