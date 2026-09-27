import type { WikiArticle } from "../types";

export const appealsInDenialDesk: WikiArticle = {
  slug: "appeals-in-denialdesk",
  title: "Appeals in DenialDesk",
  summary:
    "The appeal lifecycle, where its deadline comes from, and the Medicare appeal levels DenialDesk knows about.",
  category: "denials-and-appeals",
  tags: [
    "appeal",
    "lifecycle",
    "deadline",
    "Medicare",
    "redetermination",
    "reconsideration",
    "ALJ",
    "follow-up",
  ],
  reviewedOn: "2026-09-27",
  sources: [
    { label: "Appeals spec (internal)" },
    { label: "Rules engine catalog, Medicare appeal rules (internal, cited on each rule)" },
    { label: "Requirements baseline §8.4 and R-4.2.1 (internal)" },
  ],
  related: ["working-the-denial-queue", "florida-prompt-pay-clock", "timely-filing-windows"],
  body: `
An appeal is its own record, linked to one denial. Its status follows a fixed path so a reviewer can
always tell what has and has not happened.

## Lifecycle

1. **Draft**: created from the denial page with **Start appeal**.
2. **In review**: someone is checking the draft.
3. **Ready**: approved to send.
4. **Submitted**: the method, date, and tracking reference are recorded.
5. **Awaiting decision**.
6. **Decided**: the outcome, decision date, recovered amount, and close reason are recorded, and the
   linked denial's status is updated.

A submitted or awaiting appeal can also be **withdrawn** or **dismissed**. The database enforces this
order, so a status cannot be skipped or wound back by mistake.

## Where the deadline comes from

The deadline is computed when the appeal is created, from the denial's notice date and the payer's
regime, by the rules engine; it is never typed in or guessed. If the regime has no rule (for example
a commercial payer whose appeal window is set by contract), the appeal shows no deadline until the
payer's contract terms are configured.

## Medicare appeal levels

For traditional Medicare, DenialDesk carries the five-level appeal ladder. Values come from the
rules engine as of today; each is marked while it is still awaiting counsel's confirmation.

| Level | Request | Window after the prior decision is received |
| --- | --- | --- |
| 1 | Redetermination | {{rule:medicare.redetermination.filing_window}} |
| 2 | Reconsideration | {{rule:medicare.reconsideration.filing_window}} |
| 3 | Administrative law judge hearing | {{rule:medicare.alj_hearing.filing_window}} |
| 4 | Medicare Appeals Council review | {{rule:medicare.council_review.filing_window}} |
| 5 | Judicial review | {{rule:medicare.judicial_review.filing_window}} |

A notice is presumed received {{rule:medicare.redetermination.receipt_presumption}} after its date
unless there is evidence otherwise; later-level decisions use
{{rule:medicare.appeals.receipt_presumption}}. Levels 3 and 5 also require a minimum amount in
controversy that is not yet recorded in DenialDesk.

> **Planned:** letter templates with merge fields (a person reviews before export), the escalation
> workflow between Medicare levels, attachments, and overturn-rate analytics.

## Follow-up reminders

A practice-level default sets how many days after submission an appeal is flagged for follow-up.
This is a working preference, not a legal deadline; administrators will be able to change it under
Settings once that page ships.
`,
};
