import type { WikiArticle } from "../types";

export const readingADenial: WikiArticle = {
  slug: "reading-a-denial",
  title: "Reading a denial: CARC, RARC, and group codes",
  summary:
    "What the three kinds of code on a denial tell you, where their official meanings come from, and how DenialDesk categorizes a denial.",
  category: "denials-and-appeals",
  tags: ["CARC", "RARC", "group code", "CO", "PR", "OA", "PI", "adjustment", "category", "835"],
  reviewedOn: "2026-09-27",
  sources: [
    {
      label: "X12 external code lists: Claim Adjustment Reason Codes and Remittance Advice Remark Codes",
      href: "https://x12.org/codes",
    },
    { label: "Requirements baseline §8.3, denial management (internal)" },
  ],
  related: ["working-the-denial-queue", "remittances-and-posting", "glossary"],
  body: `
A payer explains a denial or a reduced payment with codes on the remittance advice (the 835). Each
code comes from a list that DenialDesk does not write; the lists are maintained by X12 and updated
three times a year. DenialDesk shows the codes and a short label, and links to the official list for
the full text.

## The three kinds of code

| Code | Full name | What it answers |
| --- | --- | --- |
| **Group code** | Claim adjustment group code | Who is responsible for the adjusted amount. |
| **CARC** | Claim adjustment reason code | Why the payer adjusted the amount. |
| **RARC** | Remittance advice remark code | Extra explanation or an instruction, added to a CARC. |

A group code is always paired with a CARC. A RARC is optional; some CARCs require one.

## Group codes

| Group code | Stands for |
| --- | --- |
| \`CO\` | Contractual obligation |
| \`PR\` | Patient responsibility |
| \`OA\` | Other adjustment |
| \`PI\` | Payer-initiated reduction |

The group code matters as much as the reason: the same CARC under \`PR\` means bill the patient, and
under \`CO\` means the practice absorbs it or appeals.

> DenialDesk never invents a code's meaning. Its short labels are summaries, marked unverified until
> they are checked against the current X12 release. When a code is not in the short-label table, the
> page shows the code itself; look it up on the X12 list. The denial is still worked normally.

## Denial categories

DenialDesk groups denials into working categories so the queue and the reports can sort them:
eligibility, authorization, coding, medical necessity, timely filing, duplicate, bundling,
coordination of benefits, missing information, and credentialing. The category is assigned from the
CARC through DenialDesk's own mapping, which is not part of X12; a CARC the mapping does not know goes
to **Other** for a person to classify. A category set by that mapping is shown as unverified until
the mapping has been checked.

## Where the codes show up

- The **denial page** lists the CARC summary, the group and remark codes, the claim and its lines.
- The **denial queue** filters by category and payer.
- **Insight** reports denials by category and by CARC, and by payer.
`,
};
