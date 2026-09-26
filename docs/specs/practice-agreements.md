# Spec: Business Associate Agreements per practice (operator console)

Status: done (2026-09-26) — requested by the product owner
Roadmap item: Phase 0 → platform operations; REQUIREMENTS §5.5 (BAAs)
Requirement IDs: R-5.5.1, R-7.1.3 (synthetic-only pre-production), R-7.2.3 and R-7.5.1 (applied by
analogy: the BAA is Confidential contract data, not PHI), REQUIREMENTS §9.1 (classification) and
§9.2 (retention row: HIPAA policies and BAAs)

## Goal
The platform operator can record the signed Business Associate Agreement (BAA) for each customer
practice, see at a glance which practices have an active BAA, and retrieve the signed copy when a
customer, auditor, or counsel asks for it.

## User stories
- As the platform operator, I open a practice and record its signed BAA (the PDF plus its dates
  and signers) so the agreement is stored with the practice it covers.
- As the platform operator, I see on the practices list which practices have an active BAA, which
  have none, and which expire soon, so no practice runs without an agreement.
- As the platform operator, I download the signed copy of any BAA (current or superseded) for an
  audit or a customer request.
- As the platform operator, I record a renewed BAA and the previous one is kept as superseded, so
  the agreement history stays complete for the retention period.

## Acceptance criteria
- [x] Each customer practice has a page in the operator console (`/operator/practices/<id>`) with
      practice-level metadata and an "Agreements" section. Demo practices have no agreements
      section (a demo practice never holds real data, so it has no BAA).
- [x] Record a BAA: PDF file (checked by content, not just extension; up to 5 MB), effective date,
      optional expiration date (blank = until terminated), date signed, practice signer (name and
      title), DenialDesk signer, BAA template version, optional note. Expiration before the
      effective date, signed date in the future, or a non-PDF file is rejected with a plain message.
- [x] The signed copy is stored in the platform database (U.S. region, encrypted at rest like
      everything else) with its SHA-256 so a downloaded copy can be verified against the record.
- [x] One active BAA per practice: recording a new one marks the previous active one superseded and
      links the two. Superseded agreements stay listed and downloadable.
- [x] Agreements are never deleted or edited after recording (the database blocks UPDATE of the
      recorded fields and every DELETE); the only change allowed is the status transition.
      Retention follows REQUIREMENTS §9.2 (BAAs: 6 years minimum under 45 CFR 164.316(b)(2)(i),
      7 years by our policy). Disposal after retention is a later, separate capability.
- [x] Status shown per practice from the agreements on file: **No BAA** (no active agreement),
      **Not yet effective**, **Active**, **Expiring soon** (coverage ends within 60 days — an
      operational reminder, not a legal threshold — with no renewal on file that takes over without
      a gap), **Expired**. A renewal recorded before it starts supersedes the current agreement at
      once, so coverage is judged by whichever agreement covers today: the active one, or its
      superseded predecessor until the renewal starts. Boundary tests cover the day before, the day
      of, and the day after the effective and expiration dates, and the hand-over between the two.
- [x] The practices list shows the BAA status next to each customer practice and links to the
      practice page.
- [x] Download is a link on the practice page (`Content-Disposition: attachment`, no caching).
- [x] Only a verified operator session can view a practice page, record, or download an
      agreement. Practice users, demo sessions, and the app database role cannot reach the
      agreements table at all.
- [x] Synthetic-only environments (everything but production outside Netlify, ADR 0003) accept
      only files named `SYN-…` with the operator's attestation that the document is synthetic, so
      a real signed agreement can't land in pre-production.
- [x] Two recordings racing for one practice: one wins; the other gets a plain message. Database
      errors are sanitized before they can be logged (the raw message would carry the file).
- [x] Audit events: `operator.practice_viewed`, `operator.agreement_recorded` (with the superseded
      agreement's ID when there is one), `operator.agreement_downloaded`. Metadata holds IDs, the
      template version, and byte counts only.

## Data / API changes
- New table `tenant_agreements` (platform record, not tenant data): id, tenant_id, kind (`baa`),
  status (`active` | `superseded`), effective_date, expires_on, signed_on, practice_signer,
  our_signer, template_version (token, also in audit metadata), note, filename (≤ 255 chars),
  content_type, size_bytes, sha256, content (bytea), recorded_by (operator user),
  superseded_by_id (deferred self-reference), created_at. No grants to `denialdesk_app`, and RLS
  enabled with no policies as defense in depth; read and written only as the connection owner from
  `src/domain/platform/agreements.ts`. The `operator.agreement_recorded` event commits in the same
  transaction as the record.
- Trigger `tenant_agreements_guard`: rejects DELETE and TRUNCATE; rejects UPDATE unless only
  status and superseded_by_id change.
- Data classification (§9.1): **Confidential** (contract documents; the practice's legal name and
  signer names). Never PHI. The file content is never logged; audit metadata holds counts, IDs,
  and the template version token.
- Server action `recordAgreement`; route handler
  `GET /operator/practices/<tenantId>/agreements/<agreementId>/download`.

## Legal rules used
None (no legal clock is computed). Retention period is cited from REQUIREMENTS §9.2; the 60-day
expiring reminder is an operational setting in the domain module, not a statutory value.

## Out of scope
- Termination (marking a BAA ended and starting the R-9.2.2 data-return clock) — needs the
  contract-termination process first.
- Blocking sign-in for practices without an active BAA (see open questions).
- Downstream BAAs with our own vendors (R-5.5.2) — a platform-level list, not per practice.
- E-signature or sending the BAA for signature; the practice's own view of its BAA (R-10.8).
- Other agreement kinds (MSA, order forms); the `kind` column is there so they can be added
  without a schema change.
- Disposal after the retention period.

## Security notes
- Files are validated by magic bytes (`%PDF-`) and size before they touch the database, are kept
  in memory only, and are served with `nosniff` and as an attachment so the browser never renders
  a PDF inline from our origin.
- The table is not tenant data: the app role has no privileges on it, and RLS is enabled with no
  policies so a stray GRANT would still show practice sessions nothing; both are tested in
  `test/integration/agreements.test.ts`.
- Uploaded PDFs are not scanned for malware; the operator is the only uploader and downloader.
- The operator console's existing gates apply (configured email, MFA, no practice membership).

## Open questions
- Should a practice without an active BAA be blocked from signing in, or only flagged? Flagged
  today. Blocking would enforce "BAA before access" in code rather than in the operator's process.
- Who countersigns for DenialDesk and what the current template version is (R-5.5.1, counsel).
- Corrections and history: every recording becomes the active agreement, so an older agreement
  can't be back-filled for the record without demoting the current one, and a typo can only be
  fixed by recording again. Options: a "recorded in error" status with a reason, or a historical
  import path. Not built until the owner decides.
- When a contract ends, the R-9.2.2 duty to return or destroy the practice's data will meet the
  BAA retention rule; counsel to confirm the BAA record outlives the practice's data.
