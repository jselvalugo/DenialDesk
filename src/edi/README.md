# src/edi

X12 parsing and generation (837P, 835, 999, 277CA, …) and the clearinghouse interface. Owned by the `edi-x12-specialist` agent. Treat all inbound files as untrusted.

## 835 (005010X221A1) — remittance advice

`src/edi/x12/segments.ts` tokenizes raw X12 into `{ id, elements, position }[]`, detecting the
element separator (ISA position 3) and segment terminator (the character after ISA16, position 105) from the ISA header, or defaulting to `*`/`~` for files without an ISA. It caps input at 5 MB
and strips stray CR/LF around segments.

`src/edi/x12/835.ts` exports:

- `parse835(text): Remittance835` — parses a single 835 transaction set into payment info
  (method, total paid, payment date, trace number), payer info (name, EDI payer ID), and one
  `Claim835` per `CLP` loop with merged CO/PR/OA/PI adjustments (claim-level and every
  service-line `CAS`, summed by group+CARC) and de-duplicated remark codes (`MOA`/`MIA` remarks,
  `LQ*HE`).
- `build835(remit, options?): string` — builds a synthetic 835 file from a `Remittance835` for
  fixtures and tests. It never writes patient names (no `NM1*QC`) and never carries bank account
  or routing numbers, because `Remittance835` does not model them (minimum necessary, R-7.4.6).
- `Edi835Error` — thrown for structural or validation problems. Messages cite segment position
  and claim numbers (`CLP01`) only, never patient names or member IDs.

Validation performed by `parse835`:

- Exactly one `ST*835` transaction set per file (0 or >1 is rejected — "one remittance per file").
- Required segments: `BPR`, `TRN`, `N1*PR`, at least one `CLP`.
- Monetary amounts are parsed as decimal strings (no floating-point math) into integer cents;
  malformed amounts (e.g. more than 2 decimal places) are rejected.
- Dates (`BPR16`, CCYYMMDD) are validated as real calendar dates and converted to ISO
  (`YYYY-MM-DD`).
- Payment method is derived from `BPR01`/`BPR04` (`C`/`I` + `CHK`→check, `ACH`/`FWT`/`BOP`→eft;
  `H` or `NON`→non_payment).
- Balancing: `sum(CLP04)` must equal `BPR02 + sum(PLB amounts)` (provider-level adjustments
  subtracted); an imbalance throws `Edi835Error`.
- `NM1*QC` (patient) and `NM1*IL` (subscriber) segments are never read or stored.

Tests live in `src/edi/x12/835.test.ts` (Vitest, synthetic fixtures only, R-1) and cover: a full
build→parse round trip, custom ISA-declared separators, multi-triplet and SVC-level `CAS`
merging, `MOA`/`LQ*HE` remark extraction, reversals (`CLP02=22`, negative paid), `PLB` balancing,
and rejection of a missing/duplicate `ST*835`, an unbalanced remittance, a malformed amount, a
malformed date, oversize input, and confirms error messages never leak `NM1*QC` patient names.

Maps to R-4.1 (835 remittance advice transaction) and R-8.2 step 7 (remittance posting /
reconciliation).
