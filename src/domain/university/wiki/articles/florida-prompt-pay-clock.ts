import type { WikiArticle } from "../types";

export const floridaPromptPayClock: WikiArticle = {
  slug: "florida-prompt-pay-clock",
  title: "The Florida prompt-pay clock",
  summary:
    "What the prompt-pay clock measures for a claim under Florida's insurer and HMO statutes, the milestones DenialDesk tracks, and how interest is worked out.",
  category: "florida-and-medicare-rules",
  tags: [
    "prompt pay",
    "Florida",
    "627.6131",
    "641.3155",
    "milestones",
    "contest",
    "uncontestable",
    "interest",
    "clock",
  ],
  reviewedOn: "2026-09-27",
  sources: [
    {
      label:
        "Fla. Stat. § 627.6131 (insurers) and § 641.3155 (HMOs), as recorded in the rules engine (internal, pending counsel)",
    },
    { label: "Requirements baseline §3.1 (internal)" },
    { label: "Remittances and prompt pay spec (internal)" },
  ],
  related: ["timely-filing-windows", "remittances-and-posting", "appeals-in-denialdesk"],
  body: `
Florida law gives a health insurer or HMO fixed periods to acknowledge, pay, deny, or contest a
claim after it receives it. DenialDesk keeps one clock per claim on the [Prompt pay](/prompt-pay)
page so the practice can see which milestone is next, whether the payer met it, and what interest
is owed when it did not.

## Which claims get a clock

Only claims whose payer is a **Florida insurer** or a **Florida HMO**. Traditional Medicare, Medicare
Advantage, and self-funded employer plans (ERISA) are not under the Florida statute, so their claims
show no prompt-pay clock. A payer whose regime is not yet verified gets no clock either.

## The milestones (electronic claims, Florida insurers)

Every value below is read from the rules engine as of today, with its citation. A value marked
unconfirmed is still waiting for Florida healthcare counsel to confirm it.

| Milestone | The payer must act within |
| --- | --- |
| Acknowledge receipt | {{rule:fl.promptpay.electronic.acknowledgment}} |
| Pay, or notify that the claim is denied or contested | {{rule:fl.promptpay.electronic.pay_or_contest}} |
| Pay or deny | {{rule:fl.promptpay.electronic.pay_or_deny}} |
| Uncontestable obligation to pay | {{rule:fl.promptpay.electronic.uncontestable}} |

If the payer **contests** the claim and asks for more information, the practice must answer within
{{rule:fl.promptpay.electronic.provider_response}} of the request.

## Paper claims

Paper claims have longer periods: acknowledgement within {{rule:fl.promptpay.paper.acknowledgment}},
pay, deny, or contest within {{rule:fl.promptpay.paper.pay_or_contest}}, pay or deny within
{{rule:fl.promptpay.paper.pay_or_deny}}, and the uncontestable obligation at
{{rule:fl.promptpay.paper.uncontestable}}.

## HMOs

The HMO statute mirrors the insurer periods; DenialDesk keeps a separate rule set for it so the
two can diverge if counsel finds they do. For example, an HMO must pay or contest an electronic
claim within {{rule:fl.hmo.promptpay.electronic.pay_or_contest}}.

## How DenialDesk decides a milestone was met

- The clock starts on the date the payer **received** the claim.
- "Pay or contest" is met by the first payer response of any kind; "pay or deny" and the
  uncontestable milestone only by a payment or a denial.
- A response on the due date counts as on time.
- Payments and denials come from posted remittances. A **contest** or request for information is
  recorded by a person on the claim's prompt-pay page, with the date; it is never inferred from a
  code. A response recorded by mistake is marked **recorded in error** with a reason, and nothing is
  deleted.

## Interest

A late payment accrues simple interest at {{rule:fl.promptpay.interest_rate}}. The worksheet on the
prompt-pay page shows each late payment, the days late, and the interest to the cent, so it can be
attached to a demand.

> The day interest starts accruing is an open question for counsel. The owner's working answer is
> the first calendar day after the payment deadline; the worksheet says so on each line until counsel
> confirms.

## "Pending counsel" dates

When a computed last day falls on a weekend or a Florida legal holiday, DenialDesk also shows the
next business day as "pending counsel". Until counsel confirms the roll-forward rule, the earlier,
unrolled date is the one that governs alerts and status.
`,
};
