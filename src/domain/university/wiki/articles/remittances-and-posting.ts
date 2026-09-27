import type { WikiArticle } from "../types";

export const remittancesAndPosting: WikiArticle = {
  slug: "remittances-and-posting",
  title: "Remittances and posting",
  summary:
    "Loading an 835 remittance file, what the balance check does, what posting changes, and how reversals and denials are captured from it.",
  category: "claims-and-payments",
  tags: ["remittance", "835", "ERA", "posting", "void", "reversal", "balance", "denial capture"],
  reviewedOn: "2026-09-27",
  sources: [
    { label: "Remittances and prompt pay spec (internal)" },
    {
      label: "X12 835 Health Care Claim Payment/Advice (transaction set overview)",
      href: "https://x12.org/products/transaction-sets",
    },
  ],
  related: ["how-a-claim-becomes-a-denial", "reading-a-denial", "florida-prompt-pay-clock"],
  body: `
A remittance is the payer's statement of what it paid, adjusted, or denied on a batch of claims. It
arrives as an **835** file (also called an electronic remittance advice, or ERA). DenialDesk turns one
835 into one remittance record.

## Loading a file

1. Open [Remittances](/remittances) and choose **New remittance**.
2. Upload one 835 file. DenialDesk parses it as untrusted input: an error names the segment that
   failed, never the file's contents.
3. The payer is matched by its EDI payer ID, and every claim in the file must match one of that
   payer's claims in DenialDesk.
4. The **balance check** confirms that the claim payments, net of provider-level adjustments, equal
   the payment total. A file that does not balance still loads so you can see it, but it cannot be
   posted; void it with a reason and ask the payer for a corrected file.

> **Planned:** a clearinghouse feed that delivers 835 files automatically, line-level posting, and
> re-association of a remittance with its bank deposit.

## Posting

Posting a received remittance:

- writes a new version of each claim with its new status and paid amount (earlier versions are
  kept);
- records the payer response on each claim's prompt-pay clock;
- captures a **denial** for each claim-level adjustment the practice would not expect (any group
  other than patient responsibility, except the contractual fee-schedule reduction \`CO 45\`), with
  its group code, CARC, remark codes, amount, and an appeal deadline from the rules engine.

Posted and void are final states. A remittance loaded by mistake is **voided** with a reason before
posting; nothing is ever deleted, and every load, post, and void is recorded with the user.

## Reversals

When a payer takes back a payment, the file carries a reversal (a negative payment on the claim).
Posting it lowers the claim's paid total with a new version and marks the earlier payment on the
prompt-pay clock as recorded in error, naming the reversing remittance. A reversal that matches no
payment, exceeds the amount paid, or is for zero is refused so a person can reconcile it.

## Where to look next

- The claim's page shows a **Payments** panel linking each remittance that touched it.
- Captured denials appear in the [denial queue](/denials) linked back to their remittance.
`,
};
