import type { WikiArticle } from "../types";

export const dataSafetyInDenialDesk: WikiArticle = {
  slug: "data-safety-in-denialdesk",
  title: "Data safety in DenialDesk",
  summary:
    "The safeguards every user should know: synthetic pre-production data, masking, audit, sessions, and what must never be entered where.",
  category: "data-safety",
  tags: ["PHI", "HIPAA", "audit", "masking", "MFA", "session", "synthetic data", "residency", "security"],
  reviewedOn: "2026-09-27",
  sources: [
    { label: "Requirements baseline §5, §7, and §9 (internal)" },
    { label: "Fla. Stat. § 408.051(3), data residency (as recorded in the requirements baseline)" },
  ],
  related: ["roles-and-permissions", "welcome-to-denialdesk"],
  body: `
DenialDesk handles protected health information (PHI) for its customer practices. These are the
safeguards you will meet as a user, and the habits they depend on.

## Two environments

- **Pre-production** (the preview site) holds **synthetic data only**. A banner says so on every
  page. Never enter a real patient, claim, or document there, even to test.
- **Production** is hosted in United States regions only; no service that stores or processes PHI
  may run outside the U.S.

## Signing in

- Every account uses multi-factor authentication.
- A session ends after 15 minutes without activity, with a warning two minutes before. Sign in
  again to continue; nothing you saved is lost.

## What is masked and what is recorded

- Member IDs and other high-risk identifiers are stored encrypted and shown masked. **Reveal** asks
  for a reason and writes an audit event with your name, the record, and the time.
- Every read or change of a patient, claim, denial, appeal, or remittance is written to an audit log
  that cannot be edited or deleted.
- Exports (Insight workbooks) are explicit, audited actions limited to certain roles.

## What is never done

- No patient name or identifier appears in a web address, page title, error message, or log.
- No procedure or diagnosis code is changed automatically; a coding change is made by a person and
  recorded.
- Nothing is deleted from history. Mistakes are corrected with a new entry marked "recorded in
  error" and a reason.

## Your part

- Use only your own account; never share a sign-in.
- Choose the least revealing way to do a task: open the record you need rather than browsing, and
  reveal an identifier only when the work needs it. Patient searches are never put in a web address.
- Report anything that looks like real patient data in pre-production, or an identifier shown
  unmasked where it should not be, to your administrator the same day.
`,
};
