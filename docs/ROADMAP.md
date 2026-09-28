# Roadmap

Follows `docs/REQUIREMENTS.md` §12. Each item becomes a spec in `docs/specs/` and then one or
more GitHub issues. Requirement IDs in brackets. Work top to bottom; don't start a phase until
the previous one is merged. Items marked (human) are not agent work.

## Phase 0 — Foundation
Compliance and legal (human):
- [ ] Regulatory role memo signed off by counsel [R-2.1]
- [ ] Florida healthcare counsel engaged; answers to REQUIREMENTS §13 open questions
- [ ] Azure BAA in place; clearinghouse selected and subcontractor BAA signed [R-2.2, R-5.5.2]
- [ ] Security Officer and Privacy Officer named [R-10.1]
- [ ] Risk analysis and core policies drafted; compliance automation tool chosen [§6.4]

Engineering:
- [x] ADR 0001 tech stack accepted (ADR 0003 Netlify pre-prod accepted; ADR 0002 Azure confirmed at cutover)
- [x] Project skeleton: app, DB, test runner, lint, CI on every PR [R-7.4.2, R-7.4.4]
- [x] Design system foundation + app shell (`docs/DESIGN.md`, ADR 0004)
- [x] Netlify deploy previews + pre-production site (https://denialdesk.netlify.app, no demo login since 2026-09-26) with pre-prod guards: synthetic banner, synthetic-only uploads, restricted access (ADR 0003) [R-7.1.3] — runbook: docs/runbooks/netlify.md
- [x] Synthetic data generator: practices, providers, payers, patients, claims, denials [R-15.1]
- [x] Tenancy + RBAC skeleton with row-level security and isolation tests [R-7.2.3, R-7.2.4]
- [x] Auth: OIDC SSO behind an interface (Entra ID at cutover), MFA, session timeouts [R-7.2.1, R-7.2.2, R-7.2.7]
- [x] Platform console with its own sign-in and a practice-free operator account (`specs/operator-login.md`) [R-7.2.3, R-7.2.7, R-7.5.1]
- [x] Signed BAA on file per customer practice, with status on the practices list (`specs/practice-agreements.md`) [R-5.5.1, R-7.1.3, R-7.5.1, §9.2]
- [ ] **Production gate:** WebAuthn/passkeys for the operator (TOTP today) and just-in-time, approved, recorded privileged access [R-7.2.2, R-7.2.5] (`threat-models/operator-console.md`)
- [ ] **Production gate:** break-glass for the operator: alert on `operator.credential_*` events to a channel the owner doesn't solely control, documented after-the-fact review; phishing-resistant MFA on the hosting accounts; written single-administrator risk acceptance [R-7.2.6, R-7.2.8]
- [x] Immutable audit log skeleton [R-7.5.1]
- [x] Rules-engine skeleton: versioned, effective-dated rules with citations; business-day
      and holiday calendars in America/New_York [R-15.6, §11]

## Phase 1 — MVP (FL commercial, FL HMO, Medicare, Medicare Advantage)
Setup:
- [ ] Practice, location, and provider setup (NPI, taxonomy, FL license) [§8.1]
- [ ] Payer master with regulatory-regime tags [§8.1, §1.3]
- [~] Custom field values on patient, claim, denial, and payer records (sensitive fields masked, opened with a reason, audited) [R-3.5.1, R-7.5.1] — `specs/settings-and-custom-fields.md` S2; added to MVP by owner 2026-09-26. Patients done (PR 2); claims/denials (PR 3) and payers (PR 4) in progress
- [ ] **Patient Register synced from the practice EHR/PM** over HL7 FHIR R4 / US Core with SMART Backend Services — read-only copy of the billing minimum, data-source drop-down beside the Patients tab, Patients table only for now (owner 2026-09-27; `specs/patient-integrations.md`, ADR 0010) [§8.8, R-5.1.2, R-7.3.3, R-7.5.1] — PI0 design done (revised after security/compliance review 2026-09-28, OA-057); PI1a data layer + registry done (#77); PI1b Settings › Integrations + drop-down (done: PI1b-1 domain #82, PI1b-2 pages #84, PI1b-3 drop-down), PI2a transport/SSRF guard/keys/test + Submit (real → awaiting approval), PI1c operator approval (done except the activation notice and the registry-conflict operator alert, open spec items; PR #89), PI2b sync engine + jobs + synthetic sandbox (sandbox Submit becomes possible here), PI3 scheduled sync, PI4 Bulk Data (before the first real practice)
- [x] Record pages on one reusable pattern (`specs/record-pages.md`) [R-7.1.3, R-11.1] — P1 Patients, P2 Claims/Denials headers, P3 forms onto FormShell, P4 sortable tables (review follow-ups #80)
- [~] DenialDesk University: in-app courses with per-user completion record, reachable from the header and user menu [R-10.4] — U1 catalog/lessons/completions done (`specs/denialdesk-university.md`); U2 knowledge checks, U3 practice training record planned

Claims:
- [x] Revenue cycle accounting module: monthly PM file, rules and ledger, journal vouchers, aging, deposits, statements, RCM dashboard (`specs/revenue-cycle-accounting.md`)
- [x] Claim data model with immutable version history [R-3.10.3] — claims list/detail, corrections with reason, append-only `claim_versions` (`specs/claims.md` C1)
- [ ] Charge capture via CSV import [§8.2]
- [ ] Timely-filing guardrail (6 months FL, 12 months Medicare) [R-3.1.5] — warnings done (C1); blocking at submission comes with 837P (C3)
- [ ] 837P generation and clearinghouse submission [§4.1, §8.2]
- [ ] 999 / 277CA acknowledgment capture [R-3.1.1]

Prompt pay (FL-regulated claims only):
- [~] Prompt-pay clock and configurable alerts [R-3.1.1, R-3.1.2] — PP1 clock, milestones, interest worksheet, contests (`specs/remittances-and-prompt-pay.md`); alerts inbox PP2
- [x] Late-payment interest calculator and itemized worksheet [R-3.1.3] (PP1; accrual start ⚠️ VERIFY)
- [ ] Uncontestable-obligation flag and demand letter [R-3.1.4]

Remittance and denials:
- [~] 835 ERA ingestion and posting with exception queue [§8.2] — R1 upload, balance check, post/void with history; clearinghouse feed R3
- [ ] Denial capture with CARC/RARC/group code and categorization [§8.3]
- [x] Denial work queue prioritized by $ and days to appeal deadline [§8.3]
- [x] Denial detail: notes, assignment, status

Appeals:
- [x] Appeal deadline engine per payer regime [§8.4]
- [x] Appeal case record, work list, and first-level lifecycle (create, submit, decide), synced to
      the denial's status (`specs/appeals.md` A1) [§8.4]
- [ ] Appeal letter templates with merge fields and attachments; human review before export [R-7.11.2]
- [ ] Corrected (freq 7) and void (freq 8) claims [§8.3]
- [ ] Medicare 5-level appeal workflow [R-4.2.1]
- [ ] Appeal outcome tracking (basic decision recording is in A1; a payer/category analytics view is A4)

University:
- [x] Wiki: reference articles with legal values read from the rules engine (`specs/university-wiki.md`) [R-10.4, R-15.6]
- [ ] Rest of the University (owner to structure: OA-036) [R-10.4]

Evidence and security:
- [ ] OIR complaint evidence package export [R-3.1.7]
- [ ] Customer-facing audit log viewer and export [R-7.5.4]

## Production cutover to Azure — gate before the first real practice
- [ ] Confirm regions (East US 2 likely) and accept ADR 0002 (human)
- [ ] Azure landing zone as IaC: prod/staging/dev subscriptions, U.S.-only Azure Policy [R-3.3.2, R-7.1]
- [ ] Key Vault, Entra ID, private networking, WORM audit storage, backups + DR region [R-7.3, R-7.5.1, R-7.9]
- [ ] Live clearinghouse connection under subcontractor BAA [R-2.2, R-5.5.2]
- [ ] Penetration test and restore test on the Azure environment [R-7.6.1, R-7.9.3]
- [ ] SOC 2 Type I audit (human)

## Phase 2 — Expansion
- [ ] Florida Medicaid FFS + SMMC rule sets [R-3.11]
- [ ] Self-funded ERISA handling
- [ ] AHCA dispute-resolution packet [R-3.2]
- [ ] Payer overpayment-demand inbox [R-3.1.6]
- [ ] Patient refund 30-day tracker [R-3.6]
- [ ] Sensitivity tags and masking [R-3.5]
- [x] Insight standard reports: denial summary by category/CARC and by payer, denial rate, open
  denials by appeal-deadline bucket, claims by status/A/R summary, appeal outcomes — aggregate-only,
  exported as formatted .xlsx workbooks (`specs/insight-standard-reports.md`) [§8.7]
- [ ] Prompt-pay scorecard and underpayment variance — planned, blocked on notice-classification
  fix and a `payer_contracts`/fee-schedule table (`specs/insight-standard-reports.md` #7–8) [§8.7]
- [ ] Eligibility (270/271) and claim status (276/277)
- [ ] SOC 2 Type II observation window → report (human)

## Phase 3 — Advanced
- [ ] AI denial prediction and AI-drafted appeals, human-in-the-loop [R-7.11]
- [ ] FHIR Prior Authorization API [R-4.4.1]
- [ ] Workers' comp and PIP modules
- [ ] Patient statements, payments, good-faith estimates [§8.6]
- [ ] HITRUST (if customers require it)
