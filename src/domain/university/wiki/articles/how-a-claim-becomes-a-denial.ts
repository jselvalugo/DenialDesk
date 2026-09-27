import type { WikiArticle } from "../types";

export const howAClaimBecomesADenial: WikiArticle = {
  slug: "how-a-claim-becomes-a-denial",
  title: "How a claim becomes a denial, and then an appeal",
  summary:
    "The path a record takes through DenialDesk: patient, claim, remittance, denial, appeal, and decision, with the steps that are still planned.",
  category: "getting-started",
  tags: ["lifecycle", "claim", "remittance", "835", "denial", "appeal", "workflow"],
  reviewedOn: "2026-09-27",
  sources: [
    { label: "Requirements baseline §8.2 to §8.4 (internal)" },
    { label: "Claims, remittances, denial queue, and appeals specs (internal)" },
  ],
  related: [
    "welcome-to-denialdesk",
    "remittances-and-posting",
    "working-the-denial-queue",
    "appeals-in-denialdesk",
  ],
  body: `
Every denial in DenialDesk traces back to a patient and a claim, and every appeal traces back to a
denial. Knowing the chain tells you which screen to open.

## 1. Patient record

A claim needs a patient with primary coverage. The [Patients](/patients) module holds
demographics, the payer, and the member ID (stored encrypted and shown masked). The patient chart
lists every claim and denial for that person.

## 2. Claim

A claim records the service date, the provider, the lines billed, and the payer. The
[Claims](/claims) list warns when a claim is close to or past its timely-filing window (see
[Timely filing windows](/university/wiki/timely-filing-windows)). A draft or rejected claim can be
corrected; the correction needs a reason, and every earlier version is kept.

> **Planned:** charge import from a CSV file, electronic submission (837P) through a clearinghouse
> with a filing block at the deadline, and capture of the clearinghouse acknowledgements (999 and
> 277CA). Until these ship, claims come from the synthetic seed or from the patient chart.

## 3. Remittance

When a payer answers, the answer arrives as an electronic remittance advice (an 835 file). Upload it
under [Remittances](/remittances): DenialDesk checks that the file balances, then you post it. Posting
records the payment, adjustments, and payer response against each claim and starts or updates the
claim's prompt-pay clock (see [Remittances and posting](/university/wiki/remittances-and-posting)).

## 4. Denial

A posted adjustment that denies a line or a claim creates a denial with its CARC, RARC, and group
codes (see [Reading a denial](/university/wiki/reading-a-denial)). Denials appear in the
[denial queue](/denials), sorted by appeal deadline and amount, where they are categorized, assigned,
and worked.

## 5. Appeal

From a denial's page, **Start appeal** opens a new appeal with a deadline computed by the rules
engine from the payer's regime. The appeal moves from draft to submitted to decided (see
[Appeals in DenialDesk](/university/wiki/appeals-in-denialdesk)); its outcome flows back to the
denial's status.

## 6. Reporting

[Insight](/insight) reports the denial rate, denials by payer and by reason, open denials by deadline
bucket, and appeal outcomes, using only your practice's own records.
`,
};
