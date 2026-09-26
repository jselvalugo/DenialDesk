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
- [ ] Project skeleton: app, DB, test runner, lint, CI on every PR [R-7.4.2, R-7.4.4]
- [ ] Netlify deploy previews + demo site with pre-prod guards: synthetic banner, synthetic-only uploads, restricted access (ADR 0003) [R-7.1.3]
- [ ] Synthetic data generator: practices, providers, payers, patients, claims, denials [R-15.1]
- [ ] Tenancy + RBAC skeleton with row-level security and isolation tests [R-7.2.3, R-7.2.4]
- [ ] Auth: OIDC SSO behind an interface (Entra ID at cutover), MFA, session timeouts [R-7.2.1, R-7.2.2, R-7.2.7]
- [ ] Immutable audit log skeleton [R-7.5.1]
- [ ] Rules-engine skeleton: versioned, effective-dated rules with citations; business-day
      and holiday calendars in America/New_York [R-15.6, §11]

## Phase 1 — MVP (FL commercial, FL HMO, Medicare, Medicare Advantage)
Setup:
- [ ] Practice, location, and provider setup (NPI, taxonomy, FL license) [§8.1]
- [ ] Payer master with regulatory-regime tags [§8.1, §1.3]

Claims:
- [ ] Claim data model with immutable version history [R-3.10.3]
- [ ] Charge capture via CSV import [§8.2]
- [ ] Timely-filing guardrail (6 months FL, 12 months Medicare) [R-3.1.5]
- [ ] 837P generation and clearinghouse submission [§4.1, §8.2]
- [ ] 999 / 277CA acknowledgment capture [R-3.1.1]

Prompt pay (FL-regulated claims only):
- [ ] Prompt-pay clock and configurable alerts [R-3.1.1, R-3.1.2]
- [ ] Late-payment interest calculator and itemized worksheet [R-3.1.3]
- [ ] Uncontestable-obligation flag and demand letter [R-3.1.4]

Remittance and denials:
- [ ] 835 ERA ingestion and posting with exception queue [§8.2]
- [ ] Denial capture with CARC/RARC/group code and categorization [§8.3]
- [ ] Denial work queue prioritized by $ and days to appeal deadline [§8.3]
- [ ] Denial detail: notes, assignment, status

Appeals:
- [ ] Appeal deadline engine per payer regime [§8.4]
- [ ] Appeal letter templates with merge fields and attachments; human review before export [R-7.11.2]
- [ ] Corrected (freq 7) and void (freq 8) claims [§8.3]
- [ ] Medicare 5-level appeal workflow [R-4.2.1]
- [ ] Appeal outcome tracking

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
- [ ] Reporting: A/R aging, denial rate, prompt-pay scorecard, underpayment variance [§8.7]
- [ ] Eligibility (270/271) and claim status (276/277)
- [ ] SOC 2 Type II observation window → report (human)

## Phase 3 — Advanced
- [ ] AI denial prediction and AI-drafted appeals, human-in-the-loop [R-7.11]
- [ ] FHIR Prior Authorization API [R-4.4.1]
- [ ] Workers' comp and PIP modules
- [ ] Patient statements, payments, good-faith estimates [§8.6]
- [ ] HITRUST (if customers require it)
