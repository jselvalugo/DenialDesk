import type { WikiArticle } from "../types";

export const glossary: WikiArticle = {
  slug: "glossary",
  title: "Glossary",
  summary: "Short definitions of the terms and file names used across DenialDesk.",
  category: "glossary",
  tags: ["definitions", "terms", "835", "837P", "999", "277CA", "ERA", "EOB", "NPI", "CPT", "ICD", "HCPCS"],
  reviewedOn: "2026-09-27",
  sources: [
    {
      label: "X12 transaction sets and external code lists",
      href: "https://x12.org/products/transaction-sets",
    },
    { label: "Requirements baseline §4.1 and §8 (internal)" },
  ],
  related: ["reading-a-denial", "how-a-claim-becomes-a-denial"],
  body: `
## Files and transactions

| Term | Meaning |
| --- | --- |
| **837P** | The electronic professional claim a practice sends to a payer (through a clearinghouse). |
| **999** | The clearinghouse's acknowledgement that a submitted file was received and readable. |
| **277CA** | The claim acknowledgement: which claims in a file were accepted or rejected before adjudication. |
| **835 / ERA** | The electronic remittance advice: the payer's statement of payments, adjustments, and denials. |
| **EOB** | Explanation of benefits: the paper or portal equivalent of an 835. |
| **270 / 271** | Eligibility inquiry and response (planned). |
| **276 / 277** | Claim status inquiry and response (planned). |
| **Clearinghouse** | The intermediary that routes claims to payers and returns acknowledgements and remittances. |

## Codes and identifiers

| Term | Meaning |
| --- | --- |
| **CARC** | Claim adjustment reason code: why a payer adjusted an amount. |
| **RARC** | Remittance advice remark code: extra explanation on an adjustment. |
| **Group code** | Who is responsible for an adjusted amount: \`CO\`, \`PR\`, \`OA\`, or \`PI\`. |
| **CPT / HCPCS** | Procedure and supply codes on a claim line. |
| **ICD-10-CM** | Diagnosis codes on a claim. |
| **NPI** | National provider identifier, for the practice and each provider. |
| **Member ID** | The patient's identifier with the payer; stored encrypted, shown masked. |
| **MBI** | Medicare beneficiary identifier; treated like a member ID. |

## Working terms

| Term | Meaning |
| --- | --- |
| **Regime** | The set of rules a payer falls under: Florida insurer, Florida HMO, Medicare, Medicare Advantage, self-funded (ERISA), and others. Set on the payer; drives every deadline. |
| **Contest** | A payer's notice that it needs more information before paying; recorded by a person on the prompt-pay page. |
| **Uncontestable obligation** | The point after which a Florida payer that has neither paid nor denied must pay. |
| **Timely filing** | The window after the date of service within which a claim must be filed. |
| **Claim version** | A snapshot of a claim; corrections and postings add versions, nothing overwrites one. |
| **Posting** | Applying a remittance to its claims. |
| **Reversal** | A payer taking back a payment on a later remittance. |
| **Recorded in error** | The way a mistaken entry is retired: a new entry with a reason, the original kept. |
| **A/R** | Accounts receivable: what is billed and not yet paid. |
| **Sensitivity tag** | An administrator's mark on a patient record that restricts who sees it and suppresses small counts in reports. |
| **Audit log** | The append-only record of who read or changed what, and when. |
`,
};
