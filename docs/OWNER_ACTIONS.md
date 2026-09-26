# Owner action items — rules for agents

Every session reads this file (it is referenced from `CLAUDE.md`). It keeps one list of everything
**the owner** has to do or decide so agents can keep building the best denial-management product
available.

## The list

- File: `docs/owner/OWNER_ACTION_ITEMS.xlsx` — **one tab only** (`Action Items`). Do not add tabs.
- Regenerate/edit with `python3 scripts/owner_actions.py` (openpyxl), or edit the file directly
  while keeping the columns and order below. Never store secrets, credentials, or PHI in it.

| Column | Meaning |
| --- | --- |
| ID | `OA-###`, next free number; never reuse or renumber |
| Status | `Open`, `In progress`, `Blocked`, `Done`, `Dropped` |
| Priority | `P0` blocks current work · `P1` blocks the next phase · `P2` before launch · `P3` nice to have |
| Category | Data source · Clarification · Decision · Legal/Compliance · Vendor/Account · Design/Brand · Business |
| Action item | What the owner must do, one imperative sentence |
| Why it matters | What it unblocks, in one line |
| What the agent needs back | Exact deliverable (file, answer, account, sign-off) |
| Requirement / spec | IDs (e.g. `R-3.1.3`) or spec path |
| Raised by / date | Agent or session and `YYYY-MM-DD` |
| Due / needed by | Date or milestone |
| Owner notes / answer | Filled in by the owner |
| Resolved on | Date it was closed |

## When an agent must update it

Add or update a row **in the same PR** whenever you:

1. Need a **data source** you cannot create synthetically (payer IDs, fee schedules, contracts,
   clearinghouse specs, sample remits, CARC/RARC licensing, etc.).
2. Need a **clarification** because a spec, requirement, or rule is ambiguous.
3. Leave a `TODO` / `⚠️ VERIFY` that only a human (owner, counsel, accountant, vendor) can clear.
4. Hit a **decision** that is the owner's (money, vendors, legal risk, branding, history rewrites,
   production access, hiring).
5. Need an **account, license, or credential** set up (never ask for the secret itself in the sheet).
6. See something that would make DenialDesk measurably better but needs owner input (market
   data, customer interviews, pricing, partnerships).

Also:

- Before adding, search the sheet; update an existing row instead of duplicating.
- When an owner answer lands in `Owner notes / answer`, act on it, set `Status` to `Done`, fill
  `Resolved on`, and move any decision into `docs/PROJECT_STATE.md` or an ADR.
- Keep `docs/PROJECT_STATE.md` → "Open questions for humans" consistent: each question there should
  point to its `OA-###`.
- Keep going on other work while an item is open; don't stall on it. Use synthetic stand-ins
  and mark them clearly.
- End-of-session summary lists any `OA-###` rows added or closed.
