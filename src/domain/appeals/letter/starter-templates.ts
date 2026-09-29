import type { DenialCategory } from "@/domain/carc";

// Starter appeal letter wording (docs/specs/appeals.md A2). Synthetic and generic on purpose:
//   - It cites NO payer rule, statute, or policy (CLAUDE.md #9). Each place one belongs holds a
//     visible `[⚠️ VERIFY: ...]` or `[FILL IN: ...]` placeholder, and a letter with a placeholder left
//     cannot be attested (merge-fields.ts `hasUnresolvedPlaceholder`).
//   - It never asks the payer to change a billed code, and nothing here changes one (CLAUDE.md #8).
//   - It is English: the payer reads it. A practice replaces it with its own wording in Settings.
// Only allow-listed merge fields are used (starter-templates.test.ts checks this).

function frame(reason: string, argument: string): string {
  return [
    "{{letter.date}}",
    "",
    "{{payer.name}}",
    "Appeals Department",
    "[FILL IN: the payer's appeals address from the denial notice]",
    "",
    "RE: Appeal of denied claim {{claim.number}}",
    "Patient: {{patient.fullName}}   Date of birth: {{patient.birthDate}}",
    "Member ID: {{patient.memberIdMasked}}",
    "Date of service: {{claim.serviceDate}}   Billed: {{claim.billedAmount}}   Denied: {{denial.amount}}",
    "Denial notice dated {{denial.noticeDate}}: CARC {{denial.carc}} ({{denial.carcDescription}}); RARC {{denial.rarcs}}",
    "",
    "To the Appeals Reviewer:",
    "",
    `On behalf of {{practice.name}}, we appeal the denial of the claim above. ${reason}`,
    "",
    argument,
    "",
    "[⚠️ VERIFY: cite the payer policy, contract provision, or law that applies. This template cites none on purpose.]",
    "",
    "We ask that the denial be reviewed and the claim reprocessed. Enclosed: [FILL IN: list of supporting documents].",
    "",
    "Sincerely,",
    "",
    "{{provider.name}}, NPI {{provider.npi}}",
    "{{practice.name}}, {{practice.city}}",
  ].join("\n");
}

const OTHER = frame(
  "The denial reason on the notice is shown above.",
  "[FILL IN: why the denial should be reversed, using only facts the record documents.]",
);

export const STARTER_TEMPLATES: Partial<Record<DenialCategory, string>> = {
  eligibility: frame(
    "The denial says the patient was not eligible on the date of service.",
    "[FILL IN: the coverage facts on the date of service and how they were confirmed, for example the eligibility check date.]",
  ),
  authorization: frame(
    "The denial says a required authorization or notification was missing.",
    "[FILL IN: the authorization or reference number and date, or the reason none was required. Do not state a number that is not on record.]",
  ),
  coding: frame(
    "The denial cites a coding or modifier issue.",
    "[FILL IN: the services billed and the documentation that supports them. This letter does not change any billed code; a corrected claim is a separate step that needs a person's recorded approval.]",
  ),
  medical_necessity: frame(
    "The denial says the service was not medically necessary.",
    "[FILL IN: the clinical facts from the record that support the service. Add only what the record documents.]",
  ),
  timely_filing: frame(
    "The denial says the claim was not filed in time.",
    "[FILL IN: proof of timely filing, such as the clearinghouse acceptance or an earlier submission date.]",
  ),
  other: OTHER,
};

/** The starter for a category, or the generic one when the category has none of its own. */
export function starterTemplate(category: DenialCategory): string {
  return STARTER_TEMPLATES[category] ?? OTHER;
}
