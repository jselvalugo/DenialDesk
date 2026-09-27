import type { WikiArticle } from "../types";

export const timelyFilingWindows: WikiArticle = {
  slug: "timely-filing-windows",
  title: "Timely filing windows",
  summary:
    "How long a practice has to file a claim under Florida law and Medicare, how DenialDesk counts it, and what the claims list warns about.",
  category: "florida-and-medicare-rules",
  tags: ["timely filing", "deadline", "Florida", "Medicare", "secondary payer", "claims", "filing block"],
  reviewedOn: "2026-09-27",
  sources: [
    {
      label:
        "Fla. Stat. § 627.6131(2) and 42 CFR § 424.44, as recorded in the rules engine (internal, pending counsel)",
    },
    { label: "Claims spec (internal)" },
    { label: "Billing-structure review §8, owner answers pending counsel (internal)" },
  ],
  related: ["florida-prompt-pay-clock", "how-a-claim-becomes-a-denial", "appeals-in-denialdesk"],
  body: `
A claim filed after the payer's filing window can be denied for that reason alone, and a
timely-filing denial is among the hardest to overturn. DenialDesk computes the window for every
unsubmitted claim and warns before it closes.

## The windows

Values are read from the rules engine as of today. A value marked unconfirmed is still waiting for
counsel.

| Claim | Window | Counted from |
| --- | --- | --- |
| Initial claim, Florida insurer | {{rule:fl.timely_filing.initial}} | Date of service (inpatient anchor pending counsel) |
| Initial claim, Florida HMO | {{rule:fl.hmo.timely_filing.initial}} | Date of service (inpatient anchor pending counsel) |
| Claim to a secondary payer, Florida | {{rule:fl.timely_filing.secondary}} | The primary payer's final determination |
| Traditional Medicare | {{rule:medicare.timely_filing}} | Date of service |

Medicare Advantage, self-funded employer plans, and other payers set their windows by contract;
DenialDesk shows **Not configured** for them until the payer's terms are entered.

## How DenialDesk counts

- A window in months or years lands on the same day of the month; when that day does not exist,
  it clamps to the month's last day (DenialDesk's working reading, pending counsel).
- A last day that falls on a weekend or holiday is also shown rolled to the next business day,
  marked "pending counsel"; the earlier date governs until counsel confirms the roll-forward rule.
- The practice's working answer (pending counsel) is that a claim is filed on time when it is
  **submitted** by the deadline, evidenced by the clearinghouse acknowledgement, not by the date the
  payer says it received it.

## What you see

- The [Claims](/claims) list flags each unsubmitted claim as open, due soon, or past deadline, with
  the date and days remaining.
- A claim whose payer's regime is not verified shows no deadline; verify the payer first.
- **Planned:** electronic submission will refuse to send a claim past its window unless a listed
  statutory exception applies (the owner is deciding which exceptions the block honors).
`,
};
