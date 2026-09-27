import type { WikiArticle } from "../types";

export const overpaymentsAndRefunds: WikiArticle = {
  slug: "overpayments-and-refunds",
  title: "Overpayments, retroactive denials, and patient refunds",
  summary:
    "The Florida periods around payer overpayment demands, retroactive denials, and refunding a patient, as recorded in the rules engine.",
  category: "florida-and-medicare-rules",
  tags: ["overpayment", "refund", "retroactive denial", "lookback", "456.0625", "patient refund"],
  reviewedOn: "2026-09-27",
  sources: [
    {
      label:
        "Fla. Stat. § 627.6131(6) and (11), § 456.0625, as recorded in the rules engine (internal, pending counsel)",
    },
    { label: "Requirements baseline §3.1 and §3.6 (internal)" },
  ],
  related: ["florida-prompt-pay-clock", "remittances-and-posting"],
  body: `
These periods are recorded in DenialDesk's rules engine so the values are ready when the features
that use them ship. They are listed here for reference; every value is read from the rules engine
as of today and is marked while it is unconfirmed by counsel.

## Payer overpayment demands (Florida insurers)

| Rule | Period | Counted from |
| --- | --- | --- |
| A payer must make its overpayment claim within | {{rule:fl.overpayment.payer_lookback}} | The payment |
| The practice must respond to an overpayment claim within | {{rule:fl.overpayment.provider_response}} | Receipt of the demand |
| A retroactive denial for ineligibility is limited to | {{rule:fl.retroactive_denial.limit}} | The payment |

The HMO statute has matching rules in DenialDesk (for example, the HMO lookback is
{{rule:fl.hmo.overpayment.payer_lookback}}).

## Refunding a patient

A practitioner who determines that a patient overpaid must refund the overpayment within
{{rule:fl.patient_refund}} of making that determination. This applies whatever the payer.

> Whether the refund rule reaches workers' compensation and auto (PIP) claims is an open question
> for counsel.

## Status in DenialDesk

- **Planned (Phase 2):** an inbox for payer overpayment demands with the response clock, and a
  refund tracker for patient credit balances.
- Today, a payer's takeback appears as a reversal on a remittance (see
  [Remittances and posting](/university/wiki/remittances-and-posting)).
`,
};
