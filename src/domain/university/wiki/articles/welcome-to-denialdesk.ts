import type { WikiArticle } from "../types";

export const welcomeToDenialDesk: WikiArticle = {
  slug: "welcome-to-denialdesk",
  title: "Welcome to DenialDesk",
  summary: "What DenialDesk is for, how its modules fit together, and how to move between them.",
  category: "getting-started",
  tags: ["overview", "modules", "navigation", "go to"],
  reviewedOn: "2026-09-27",
  sources: [
    { label: "DenialDesk product brief (internal)" },
    { label: "Requirements baseline §8 (internal)" },
  ],
  related: ["how-a-claim-becomes-a-denial", "roles-and-permissions", "glossary"],
  body: `
DenialDesk helps a Florida physician practice submit, track, and manage insurance claims and
denials: it classifies denials, prioritizes them by dollar value and deadline, tracks appeals, and
watches the Florida prompt-pay and appeal clocks so nothing expires unnoticed.

## The modules

Everything you can open lives in a module. Each module's pages are the tabs in the navy bar.

| Module | What it holds |
| --- | --- |
| **Denials** | The overview, the denial queue, and appeals. |
| **Patients** | Patient records: demographics, coverage, and every claim and denial for the patient. |
| **Claims** | Claims and their version history, remittances (835 files), and the prompt-pay clocks. |
| **Revenue cycle** | Monthly files, journal vouchers, A/R aging, deposits, and the ledger (managers, administrators, and compliance). |
| **Insight** | Standard reports on denial trends, recovery, and payer performance. |
| **Settings** | The practice profile and custom fields (administrators change them; everyone else can view). |
| **University** | This wiki. |

## Moving around

- Press **Ctrl K** (or **Command K** on a Mac), or click the "Go to" field in the header, to open
  the module switcher. Type part of a module or page name and press Enter.
- The first control in the navy bar shows the current module; click it to switch modules.
- Pages tagged **Planned** in the switcher are not built yet and are never links.

## What every screen has in common

- Deadlines always show the date, the days remaining, and the time zone (legal clocks run in
  Eastern time).
- Money is shown to the cent, right-aligned, with a minus sign for negatives.
- High-risk identifiers such as member IDs are masked; revealing one asks for a reason and is
  recorded in the audit log.
- Actions that change a record (status, assignment, corrections, postings) are recorded with who
  did them and when, and history is never rewritten.

> In pre-production, the banner at the top says **Synthetic data only**. Nothing you see there is
> a real patient or claim, and real patient data must never be entered there.
`,
};
