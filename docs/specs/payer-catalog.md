# Spec: Payer catalog (MVP)

Status: approved by owner in chat (2026-09-26) — P1 done
Roadmap item: Phase 1 → practice setup, payer master (REQUIREMENTS §8.1 "Payer master with regulatory regime tag")
Requirement IDs: R-2.2, R-15.1, §8.1

## Goal
Staff registering a patient can pick the patient's insurer from a searchable list of real
insurance companies and plans operating in Florida, so the practice can track and report
patients and claims by insurer. Until the clearinghouse payer list is connected, catalog entries
carry a name and source only; their EDI payer ID and regulatory regime stay **unverified**.

Note (2026-09-28, `docs/specs/settings-and-custom-fields.md` S2 PR 4): a minimal, read-only payer
record now exists under **Settings** — `/settings/payers` (list) and `/settings/payers/[id]`
(detail) — so a payer's own custom field values have somewhere to be shown and edited
(`/settings/payers/[id]/fields`). It is not the payer admin screen this spec's P2 still owes: name,
EDI payer ID, and regime stay uneditable there, and nothing here changes P1's catalog, resolution,
or verification behavior.

## Phases
| Phase | Scope |
|---|---|
| **P1** (this PR) | Starter catalog of Florida insurers by name (with source); unverified payers allowed; searchable Payer picker in Primary Insurance; unverified payers excluded from deadline math |
| P2 | Load payer IDs from the contracted clearinghouse payer list; admin verifies regime per payer; payer admin screen |
| P3 | Per-practice shortlist ("payers we bill"), payer aliases, filters on reports by payer |

## User stories
- As a billing specialist, I can choose the patient's insurer from a list of Florida insurers
  instead of only the practice's configured payers.
- As a doctor/manager, I can see which insurer each patient has for tracking and reporting.
- As a compliance reviewer, I can trust that no deadline or 837P uses a payer whose regime or
  payer ID has not been verified.

## Acceptance criteria (P1)
- [x] `payers.edi_payer_id` and `payers.regime` become nullable; a payer with either missing is
      **unverified**. Existing rows are unchanged.
- [x] `payers.source` (text, nullable) records where a catalog name came from.
- [x] A versioned starter catalog of Florida insurers (names only, each with a source note and
      ⚠️ VERIFY) lives in code (`src/domain/payers/florida-catalog.ts`). No payer IDs or regimes
      are invented (CLAUDE.md #9).
- [x] Each practice gets the catalog entries it does not already have (matched by name,
      case-insensitive) via an idempotent step run by the seed and available to setup; RLS and
      tenant scoping unchanged.
- [x] The Payer field in Primary Insurance is searchable and lists all of the practice's payers
      alphabetically; unverified payers are labelled "unverified".
- [x] Anywhere a regime label is shown, a null regime shows "Regime not verified".
- [x] Filing and appeal deadlines are not computed for an unverified payer; the UI shows
      "No deadline — payer not verified" instead of a date. Tests cover null regime.
- [x] Claim submission/837P generation (when built) must refuse unverified payers — enforced by a
      guard function with a unit test.
- [x] Payer names are public reference data, not PHI. Loading catalog payers into a practice is a
      configuration change and emits a `payer.catalog_loaded` audit event (count + catalog version).

## Data / API changes
- Migration: `ALTER TABLE payers ALTER COLUMN edi_payer_id DROP NOT NULL, ALTER COLUMN regime DROP NOT NULL, ADD COLUMN source text`.
- Data classification: payer names = Public reference data (REQUIREMENTS §9.1). No PHI.
- The future 837P builder/submit path (edi-x12-specialist) must call
  `assertPayerVerified`/`isPayerVerified` (`src/domain/payers/verification.ts`) before building or
  sending a claim, and refuse an unverified payer. Any caller of `rules/deadlines.ts`'s
  `appealDeadline` (or `timelyFilingDeadline`/`promptPayMilestones`) must first confirm
  `payer.regime !== null` — those functions take a verified `Regime` and must never be handed a
  guessed one.

## Legal rules used
None added. Unverified payers deliberately get **no** legal clock rather than a guessed one.

## Out of scope
Clearinghouse integration, eligibility (270/271), payer admin UI, secondary coverage.

## Open questions
- Which clearinghouse supplies payer IDs (see `docs/research/clearinghouse-requirements.pdf`).
- Owner to verify the starter catalog against the Florida OIR licensee list and AHCA SMMC plan list.
- `ensureCatalogPayers` re-adds a catalog payer by name whenever setup runs, including one a
  practice deliberately deleted or renamed. P2 (payer admin screen) should decide whether a
  practice can opt a catalog entry out permanently, e.g. a "do not re-add" marker, rather than
  relying on setup never running again.
