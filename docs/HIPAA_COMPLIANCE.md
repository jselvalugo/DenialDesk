# HIPAA and PHI protection standard

Status: **binding** (owner request, 2026-09-28). Applies to every person, agent, commit, dependency,
vendor, environment, and document in this repository. Companion: `docs/SECURE_CODING.md`.

DenialDesk is distributed to Florida physician practices as a business associate (REQUIREMENTS §2).
Every practice that runs on it inherits our mistakes. So we do not aim for "compliant enough": we
build to the strictest reading of every rule that applies, and we prove it with tests and audit
evidence.

## 0. How this document works

- **Strictest rule wins.** Where HIPAA (45 CFR Parts 160 and 164), the proposed HIPAA Security Rule
  update (REQUIREMENTS §5.3), 42 CFR Part 2, Florida law (Fla. Stat. § 408.051, § 501.171, and the
  rest of REQUIREMENTS §3), SOC 2, or a customer BAA differ, the most protective requirement applies.
- **"Addressable" means "required."** No HIPAA implementation specification is skipped because it is
  addressable (REQUIREMENTS §5.3).
- **When in doubt, it is PHI.** If you cannot tell whether a value is PHI, treat it as PHI, stop, and
  ask. Never guess in the permissive direction.
- **MUST rules are blocking.** A change that breaks a rule marked **MUST**, or makes a listed known
  gap (end of this document) worse, does not merge. `compliance-checker` cites the rule ID
  (`HC-x.y`) in its finding. Known gaps are tracked follow-ups: they block the first real practice
  (production go-live), not unrelated PRs, and new code never adds to them.
- **Exceptions** exist only as a written, time-boxed record in `docs/decisions/` that names the rule,
  the risk, the compensating control, and an expiry date, signed off by the Security Officer and the
  Privacy Officer (R-10.1). Agents cannot grant, extend, or assume an exception.
- This is an engineering standard, not legal advice. Questions for counsel go in
  `docs/owner/OWNER_ACTION_ITEMS.xlsx` (`docs/OWNER_ACTIONS.md`).

## 1. What counts as PHI here

- **HC-1.1 MUST** Treat as PHI any health, treatment, or payment information together with **any**
  of the 18 identifiers in 45 CFR 164.514(b)(2)(i) — of the individual **or of their relatives,
  employers, or household members** (subscribers and guarantors are often relatives): names;
  geographic units smaller than a state (street, city, county, ZIP); all date elements (except
  year) related to an individual, including birth, admission, discharge, service, and death dates,
  and **all ages over 89**; phone numbers; fax numbers; email addresses; SSNs; medical record
  numbers; health plan beneficiary numbers (member IDs, MBI); account numbers; certificate/license
  numbers; vehicle identifiers; device identifiers; URLs; IP addresses; biometric identifiers;
  full-face photos; and any other unique identifying number, characteristic, or code.
- **HC-1.2 MUST** In DenialDesk that explicitly includes: claims (837P) and their lines, remittances
  (835), acknowledgements (999/277CA), CARC/RARC paired with a claim, payer claim control numbers,
  appeal letters and notes, attachments and their file names, EHR/FHIR resources, patient and
  subscriber demographics, and free-text fields a user can type into.
- **HC-1.3 MUST** De-identification uses the Safe Harbor method (45 CFR 164.514(b)(2)) only: all 18
  identifiers removed **and** no actual knowledge that the rest could identify someone
  (164.514(b)(2)(ii)). Expert Determination (164.514(b)(1)) requires counsel sign-off in an ADR.
- **HC-1.4 MUST** No PHI leaves a tenant for DenialDesk's own purposes (cross-practice benchmarks,
  product metrics, marketing, investor material) unless the practice's BAA permits
  de-identification (45 CFR 164.504(e)(2)(i)) **and** the data is Safe Harbor de-identified
  (HC-1.3). Small-cell suppression (cells under 11, following CMS cell-size suppression practice,
  with complementary suppression so hidden cells cannot be back-calculated) is applied on top; on
  its own it does not de-identify anything. Counsel confirms each such use before it is built.
  Aggregates shown to a practice about its own data stay inside the tenant.
- **HC-1.5 MUST** Restricted-Sensitive categories (HIV, mental health, substance use disorder under
  42 CFR Part 2, genetic, reproductive, minors — REQUIREMENTS §3.5, §9.1) carry sensitivity tags,
  stricter access, and heightened audit. The Florida confidentiality statutes for these categories
  apply as well (HIV § 381.004, mental health § 394.4615, substance use § 397.501(7), genetic
  § 760.40 — ⚠️ VERIFY scope with counsel). Part 2 records are never redisclosed without the
  consent the regulation requires, and each permitted disclosure carries the notice required by
  42 CFR 2.32.

## 2. Where PHI may and may not exist

- **HC-2.1 MUST** PHI exists only in: the production database (encrypted, row-level security), the
  production object store, production backups, the production audit log, in transit over TLS, and
  the signed-in user's browser while a page renders it.
- **HC-2.2 MUST NOT** PHI never appears in: logs, metrics, or traces; URLs, paths, or query strings
  (use opaque UUIDs); page titles; analytics, session replay, or error trackers; crash reports;
  browser `localStorage`, `sessionStorage`, IndexedDB, or service-worker caches; cookies other than
  an opaque session ID; email or SMS bodies and subjects; push notifications; file names we
  generate; GitHub issues, PRs, commits, or Actions logs; development and coding-agent sessions and
  prompts; screenshots, test snapshots, or CI artifacts; chat tools; support tickets without a BAA.
- **HC-2.3 MUST** Responses that carry PHI send `Cache-Control: no-store`. No CDN or shared cache
  stores a PHI response.
- **HC-2.4 MUST** Every export, download, or print of PHI (CSV, XLSX, PDF, X12) is audited with
  actor, record scope, and row count; the file name contains no PHI; spreadsheet exports neutralize
  formula injection (cells starting with `=`, `+`, `-`, `@`).
- **HC-2.5 MUST** PHI exists only in production. Pre-production (Netlify), development, CI, and
  agent sessions use synthetic data only (R-7.1.3, R-15.1). Production data is never copied to a
  lower environment, not even "de-identified." Support debugging uses record IDs and the audit
  trail, never data dumps.

## 3. Minimum necessary (45 CFR 164.502(b), 164.514(d))

- **HC-3.1 MUST** Queries select only the columns the feature needs. Server code passes only the
  fields a page renders to client components; no whole PHI rows are serialized to the browser.
- **HC-3.2 MUST** Roles are default-deny. Billing staff see billing data, not clinical notes, unless
  an appeal needs them (R-5.1.2). New permissions are added narrowly and named in the spec.
- **HC-3.3 MUST** Data sent to any external party (payer, clearinghouse, EHR, vendor) is the minimum
  that party needs for the transaction, and the spec lists each field sent.
- **HC-3.4 MUST** We do not collect a PHI field "in case it is useful later." Every PHI field in the
  schema traces to a requirement ID.

## 4. Access control and authentication (45 CFR 164.312(a), (d))

- **HC-4.1 MUST** Unique user IDs. No shared, generic, or service accounts used by people.
- **HC-4.2 MUST** MFA for every user; phishing-resistant MFA (FIDO2/WebAuthn) for admins and any
  workforce with PHI access (R-7.2.2). Step-up authentication for sensitive admin actions.
- **HC-4.3 MUST** Automatic logoff: 15 minutes idle, 12 hours absolute (R-7.2.7).
- **HC-4.4 MUST** Tenant isolation at the data layer with row-level security on every table holding
  tenant data, plus an isolation test per table (R-7.2.4). Application checks are in addition to,
  never instead of, RLS.
- **HC-4.5 MUST** Authorization is checked on the server for every page load, server action, and
  route handler that touches data. Hiding a button is not access control.
- **HC-4.6 MUST** DenialDesk workforce has no standing access to customer PHI. Access is
  just-in-time, approved, time-boxed, session-recorded, and reviewed (R-7.2.5). Break-glass accounts
  alert on use and are reviewed after the fact (R-7.2.6). Access is reviewed quarterly and ends
  within 1 hour of separation (R-7.2.8).

## 5. Audit controls (45 CFR 164.312(b))

- **HC-5.1 MUST** Every PHI view, create, update, delete, export, and print emits an audit event:
  who, what (record IDs), when, where (IP/device), and why when captured (R-7.5.1).
- **HC-5.2 MUST** Audit writes fail closed: the audit event commits in the same database transaction
  as the change it records, so no change exists without its audit record and a failed audit write
  rolls the change back. Copying events to WORM storage happens afterward from that committed
  record (a transactional outbox; the design is an architect decision at the Azure cutover).
- **HC-5.3 MUST** Audit events record identifiers, not PHI values (the only exception is the
  AI-record store in HC-8.2). The audit log is append-only in the database (no code path updates or
  deletes audit rows) and immutable (WORM) in production storage (R-7.5.1). Anomalous access (mass export, after-hours, VIP or employee records) alerts in
  the SIEM (R-7.5.3), and the activity is reviewed regularly (45 CFR 164.308(a)(1)(ii)(D)).
- **HC-5.4 MUST** Audit logs are retained at least 7 years (R-7.5.2, REQUIREMENTS §9.2) and stay in
  U.S. regions under a BAA (R-7.5.5).

## 6. Integrity (45 CFR 164.312(c))

- **HC-6.1 MUST** Claim, appeal, and code edits are versioned; nothing silently overwrites PHI.
- **HC-6.2 MUST** Nothing changes CPT, ICD, or HCPCS codes without a recorded human approval
  (R-3.10.1, R-3.10.2, R-7.11.4).
- **HC-6.3 MUST** Data received from outside (X12, FHIR, CSV, uploads) is validated before it is
  stored, and rejected rather than "fixed" when it is malformed.

## 7. Transmission and encryption (45 CFR 164.312(a)(2)(iv), (e))

- **HC-7.1 MUST** TLS 1.2 or higher everywhere (prefer 1.3), HSTS, no weak ciphers; internal
  service-to-service traffic uses mTLS (R-7.3.1).
- **HC-7.2 MUST** AES-256 at rest for databases, object storage, backups, queues, and logs (R-7.3.2).
- **HC-7.3 MUST** Field-level encryption (AES-256-GCM) for SSN, MBI, member IDs, and bank data
  (R-7.3.3).
- **HC-7.4 MUST** Production keys live in Azure Key Vault (customer-managed, rotated annually,
  separation of duties); never in code, images, environment files, or the database (R-7.3.4,
  R-7.3.5).
- **HC-7.5 MUST NOT** PHI is never sent by unencrypted email, SMS, fax integration, or any channel
  we have not reviewed under this document.

## 8. Vendors, subprocessors, and U.S. residency

- **HC-8.1 MUST** No vendor, cloud service, SDK, or API receives, stores, or processes PHI unless
  **all** of these hold, recorded in `docs/data-sources.xlsx` and the subprocessor list:
  1. a signed BAA with subcontractor flow-down (R-5.5.2);
  2. storage, processing, backups, and support access in U.S. regions only (Fla. Stat.
     § 408.051(3), R-3.3.1, R-3.3.3), bound in the contract and listed with locations (R-3.3.4);
  3. screened for ownership ties to foreign countries of concern (R-3.3.6);
  4. a current SOC 2 Type II or HITRUST report reviewed, and reassessed every year (R-10.5);
  5. the service is on the vendor's HIPAA-eligible list;
  6. minimum-necessary data only (HC-3.3).
- **HC-8.2 MUST** AI/LLM services additionally require zero data retention, no training on customer
  data, and human approval before anything reaches a payer (R-7.11.1, R-7.11.2). Approvals are ordinary audit
  events. Prompts and outputs contain PHI, so they are the one exception to HC-5.3: they go to a
  separate AI-record store linked to the audit event by ID — encrypted, U.S.-only, access-
  controlled and audited like other PHI, with the audit log's retention (R-7.11.3) — and never to
  application logs (HC-2.2).
- **HC-8.3 MUST NOT** No offshore workforce, contractor, or support staff has access to PHI or to
  systems that hold it.
- **HC-8.4 MUST** A new vendor or SDK is also a third-party dependency: `docs/SECURE_CODING.md`
  Part A applies in addition to this section.

## 9. Incidents and breaches (45 CFR 164.308(a)(6), 164.314(a)(2)(i)(C), 164.410; Fla. Stat. § 501.171)

- **HC-9.1 MUST** Anyone — human or agent — who sees possible real PHI in the repository, a log, a
  ticket, or an agent session, or suspects unauthorized access: **stop**, do not copy or spread it,
  preserve evidence, and tell the human owner at once. Internal escalation within 1 hour
  (R-7.10.2).
- **HC-9.2 MUST** Every security incident is reported to the affected practice, not only breaches
  (164.314(a)(2)(i)(C)), and gets a documented four-factor risk assessment.
- **HC-9.3 MUST** Notice clocks depend on who is notified; DenialDesk's own clocks are to the
  practice, which notifies individuals, regulators, and media:
  - HIPAA: a business associate notifies the covered entity without unreasonable delay and no later
    than 60 days after discovery (164.410(b)); our contract commits to **72 hours** (REQUIREMENTS §5.4).
  - FIPA: as the practice's third-party agent, we notify the practice no later than **10 days**
    after determining the breach (§ 501.171(6)(a)); the practice's 30-day notice to individuals
    (§ 501.171(4)) runs from its own determination.
  - The operational clocks live in R-7.10.2; the shortest applicable one governs. ⚠️ VERIFY with
    counsel.
- **HC-9.4 MUST** A secret or PHI committed to git is treated as an incident: rotate the secret or
  assess the exposure first; history rewriting is a human decision.

## 10. Retention and disposal (45 CFR 164.310(d)(2)(i)-(ii); REQUIREMENTS §9.2)

- **HC-10.1 MUST** Retention follows REQUIREMENTS §9.2; legal hold overrides deletion (R-9.2.1).
- **HC-10.2 MUST** Disposal follows NIST SP 800-88 and FIPA (R-9.2.3); deletion runs through the
  disposal process, never ad-hoc SQL.
- **HC-10.3 MUST** Customer data return and certified destruction within the BAA window after
  termination (R-9.2.2).

## 11. Patient rights support (45 CFR 164.524, 164.526, 164.528)

- **HC-11.1 MUST** The platform supports the practice's obligations for access, amendment, and
  accounting of disclosures (R-5.1.1). We record every disclosure outside the practice (payer,
  clearinghouse, export) even where HIPAA exempts it from the accounting (for example, payment
  disclosures under 164.528(a)(1)(i)), so the practice can answer any request.

## 12. Administrative and physical safeguards (45 CFR 164.308, 164.310, 164.504(e))

- **HC-12.1 MUST** DenialDesk uses and discloses PHI only as each practice's BAA permits
  (164.504(e)) and never for its own purposes beyond it.
- **HC-12.2 MUST** A written risk analysis and risk-management plan, updated yearly and on every
  major change (164.308(a)(1)(ii)(A)-(B)); threat models in `docs/threat-models/` feed it.
- **HC-12.3 MUST** A sanction policy (164.308(a)(1)(ii)(C)) and security training at onboarding and
  yearly (164.308(a)(5), R-10.4).
- **HC-12.4 MUST** A contingency plan — backups, disaster recovery, emergency-mode operation — tested
  on schedule (164.308(a)(7), R-7.9.1–R-7.9.3), and a periodic technical and non-technical evaluation
  (164.308(a)(8)).
- **HC-12.5 MUST** Device and media controls: disposal, re-use, and inventory of anything that held
  PHI (164.310(d), REQUIREMENTS §7.8).

## 13. Documentation (45 CFR 164.316(b)(2))

- **HC-13.1 MUST** Policies, specs, threat models, ADRs, and this standard are kept for at least 6
  years after they stop being in effect (164.316(b)(2)(i); we keep 7).
- **HC-13.2 MUST** Changes to this document or `docs/SECURE_CODING.md` go through a PR with
  `compliance-checker` and `security-reviewer` review **and the owner's written approval in that
  PR**. This narrows CLAUDE.md #12: an agent never merges a PR that changes either standard on its
  own authority.

## 14. Review gate

Every PR is checked against this document by `compliance-checker`, and against
`docs/SECURE_CODING.md` by `security-reviewer`. The PR template checklist records the result.

## Known gaps (tracked, not waived)

These MUST rules are not yet met as of 2026-09-28. Pre-production holds synthetic data only (ADR
0003), so each is a condition for the first real practice, not a waiver.

| Rule | Gap |
| --- | --- |
| HC-4.2 | Phishing-resistant MFA (WebAuthn) not built; TOTP only (`specs/operator-login.md`, `specs/sign-in-and-sessions.md`, OA-063). |
| HC-4.6 | No just-in-time workforce access, session recording, or break-glass accounts yet. |
| HC-5.3 | No WORM audit storage or SIEM alerting yet (Azure cutover, ADR 0003). |
| HC-7.1 | No mTLS between internal services yet (Azure cutover). |
| HC-7.4 | Pre-production keys come from platform environment variables, not Key Vault (ADR 0003, OA-064). |
| HC-10.1 | No legal-hold capability yet; hard deletes of practice data are refused until it exists (`drizzle/0004_tenant_identity_rls.sql`). |
| HC-11.1 | Disclosures are recorded as audit events, but there is no per-patient accounting-of-disclosures export yet (R-5.1.1). |
| HC-12.2–12.5 | Risk analysis, sanction policy, training, contingency plan, and media controls are not written yet (REQUIREMENTS §6.4 policy set). |
