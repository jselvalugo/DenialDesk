import type { Tone } from "@/components/ui/Badge";

// Synthetic, illustrative rows for the style guide only. Payer names are fictional; patients are
// referenced by synthetic IDs, never names. Dates and days are static relative to sampleAsOf.
export const sampleAsOf = "2026-09-26";

export interface SampleRow {
  claimId: string;
  patientRef: string;
  payer: string;
  code: string;
  category: string;
  billedCents: number;
  atRiskCents: number;
  dueDate: string;
  daysRemaining: number;
  status: string;
  statusTone: Tone;
  assignee: string;
  selected?: boolean;
}

export const sampleQueue: SampleRow[] = [
  {
    claimId: "CLM-SYN-10482",
    patientRef: "PT-SYN-0142",
    payer: "Gulf Coast Mutual",
    code: "CO-29",
    category: "Timely filing",
    billedCents: 86_500,
    atRiskCents: 86_500,
    dueDate: "2026-09-23",
    daysRemaining: -3,
    status: "Overdue",
    statusTone: "danger",
    assignee: "Unassigned",
  },
  {
    claimId: "CLM-SYN-10477",
    patientRef: "PT-SYN-0388",
    payer: "Sunward HMO",
    code: "CO-197",
    category: "Authorization",
    billedCents: 412_000,
    atRiskCents: 412_000,
    dueDate: "2026-09-26",
    daysRemaining: 0,
    status: "Appeal drafted",
    statusTone: "info",
    assignee: "M. Alvarez",
    selected: true,
  },
  {
    claimId: "CLM-SYN-10451",
    patientRef: "PT-SYN-0915",
    payer: "Medicare Part B",
    code: "CO-50",
    category: "Medical necessity",
    billedCents: 238_450,
    atRiskCents: 190_760,
    dueDate: "2026-09-30",
    daysRemaining: 4,
    status: "Needs records",
    statusTone: "warning",
    assignee: "J. Chen",
  },
  {
    claimId: "CLM-SYN-10436",
    patientRef: "PT-SYN-0271",
    payer: "Keystone Advantage",
    code: "CO-16",
    category: "Missing information",
    billedCents: 64_200,
    atRiskCents: 64_200,
    dueDate: "2026-10-05",
    daysRemaining: 9,
    status: "In review",
    statusTone: "info",
    assignee: "M. Alvarez",
  },
  {
    claimId: "CLM-SYN-10419",
    patientRef: "PT-SYN-0533",
    payer: "Harborline Health",
    code: "CO-97",
    category: "Bundling",
    billedCents: 31_800,
    atRiskCents: 18_900,
    dueDate: "2026-10-21",
    daysRemaining: 25,
    status: "New",
    statusTone: "neutral",
    assignee: "Unassigned",
  },
  {
    claimId: "CLM-SYN-10398",
    patientRef: "PT-SYN-0760",
    payer: "Gulf Coast Mutual",
    code: "OA-18",
    category: "Duplicate",
    billedCents: 52_000,
    atRiskCents: 0,
    dueDate: "2026-11-09",
    daysRemaining: 44,
    status: "Closed",
    statusTone: "neutral",
    assignee: "J. Chen",
  },
  {
    claimId: "CLM-SYN-10377",
    patientRef: "PT-SYN-0114",
    payer: "Sunward HMO",
    code: "CO-197",
    category: "Authorization",
    billedCents: 158_300,
    atRiskCents: 0,
    dueDate: "2026-11-20",
    daysRemaining: 55,
    status: "Overturned",
    statusTone: "success",
    assignee: "M. Alvarez",
  },
];
