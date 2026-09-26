# rules

The rules engine: every legal deadline, rate, and threshold, versioned and effective-dated with citations and a VERIFY flag until counsel confirms it (R-15.6). Owned by the `florida-rules-engine` agent. Nothing statutory may be hard-coded anywhere else.

## Prompt-pay clock (`prompt-pay.ts`)

`evaluatePromptPay` evaluates the Florida prompt-pay clock and late-payment interest for one claim
(R-3.1.1, R-3.1.3, R-3.1.4; REQUIREMENTS §3.1; billing review 2026-09-26 finding F4).

- Applies only to FL insurer and FL HMO regimes (enforced by each rule's `regimes`); Medicare, MA,
  self-funded ERISA and others return `applies: false`.
- Milestone rules are resolved as in force on the received date; the interest rate as in force on
  each payment date. A `rules` array can be injected for effective-date tests.
- Payer responses are `payment`, `denial` or `contest` (contest / request for information is
  recorded by a person; not inferred from CARC/RARC). Responses after `today` are ignored.
- pay-or-contest is met by the first response of any kind; pay-or-deny and uncontestable only by a
  payment or denial. A response on the due date counts as met.
- Contested = a contest on/before the pay-or-contest due date. The provider response clock
  (electronic only; REQUIREMENTS gives no paper value) runs from the first contest date.
- Uncontestable = no payment or denial by the uncontestable due date.
- Interest ⚠️ VERIFY accrual start: assumed to run from the payment due date (pay-or-contest, or
  pay-or-deny once contested). Simple interest per late payment:
  cents × rate% × days late / 365, rounded half-up to whole cents in integer arithmetic.

## Rule shape and date math (`types.ts`, `deadlines.ts`)

- Each rule version carries `anchor`, `unit` (day-count), `rollForward` and `confirmedBy`.
- `ruleDueDate(rule, anchorDate)` counts the period (months/years clamp to month-end) and then
  rolls a weekend/holiday last day forward: Florida legal holidays for `fl.*`, federal for
  Medicare (⚠️ VERIFY). Decisions: `docs/specs/rules-engine-skeleton.md` (P1).
- FL insurer rules are `fl.*` (§ 627.6131); FL HMO rules are `fl.hmo.*` (§ 641.3155). The regime is
  checked before lookup (`floridaRuleSet`).
