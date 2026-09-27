import type { WikiArticle } from "../types";

export const workingTheDenialQueue: WikiArticle = {
  slug: "working-the-denial-queue",
  title: "Working the denial queue",
  summary:
    "How the queue orders denials, what the totals mean, and what happens when you change status, assign, or add a note.",
  category: "denials-and-appeals",
  tags: ["denial queue", "priority", "deadline", "assign", "status", "notes", "totals", "overview"],
  reviewedOn: "2026-09-27",
  sources: [
    { label: "Denial queue and denial detail spec (internal)" },
    { label: "Requirements baseline §8.3 (internal)" },
  ],
  related: ["reading-a-denial", "appeals-in-denialdesk", "how-a-claim-becomes-a-denial"],
  body: `
The [denial queue](/denials) is the working list for the whole practice. It exists so the denial
that will expire first, and is worth the most, is at the top.

## Order and filters

- Default order is **appeal deadline first, then amount**. You can also sort by amount or by newest
  notice date.
- Filters: status, payer, category, and assignee. Twenty-five denials per page.
- A denial whose deadline cannot be computed shows **Not configured** rather than a guess. This
  happens when the payer's regime is not verified or when the appeal window comes from a contract
  DenialDesk does not have yet.

## The totals row

| Total | Counts |
| --- | --- |
| Open denials | Every denial not yet closed. |
| Amount at risk | The billed amount on those denials. |
| Due in 7 days | Denials awaiting action whose appeal deadline is within seven days. |
| Past deadline | Denials awaiting action whose deadline has passed. |
| No deadline configured | Denials with no computable deadline. |

The two deadline counts only include denials still awaiting action. A denial with an appeal already
filed is not counted as due, even if its original window has passed.

## Actions on a denial

- **Change status**, **assign** (to a member of your practice), and **add a note**. Each action is
  recorded with who did it and when. The compliance role can read but not act.
- **Start appeal** opens a new appeal page for the denial; the deadline is computed fresh (see
  [Appeals in DenialDesk](/university/wiki/appeals-in-denialdesk)).
- **Reveal** on a masked member ID asks for a reason; the reveal is recorded in the audit log.

## Overview

The [Overview](/overview) page shows the same totals for the practice, the next deadlines, and open
denials by reason, so a manager can see the day's shape without opening the queue.
`,
};
