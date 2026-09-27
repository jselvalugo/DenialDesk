# Florida Physician Claims & Denial Management Platform
## Baseline Requirements: Security, SOC 2, HIPAA, and Florida Law

| | |
|---|---|
| **Document type** | Baseline requirements (living document) |
| **Version** | 0.1 (initial baseline) |
| **Date** | September 26, 2026 |
| **Jurisdiction** | State of Florida + applicable U.S. federal law |
| **Owner** | _[Project owner]_ |
| **Status** | Draft for legal/compliance review |

> **Important:** This document is an engineering and compliance baseline, not legal advice. Statutory deadlines, thresholds and citations below were checked against current sources as of the date above, but Florida law changes most legislative sessions (effective dates are usually July 1, October 1, or January 1). Items marked **⚠️ VERIFY** need confirmation by Florida-licensed healthcare counsel before being encoded as hard rules. All legal deadlines in the product must live in a **versioned, effective-dated rules engine**, never hard-coded.

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Regulatory Role Determination](#2-regulatory-role-determination)
3. [Florida Law Requirements](#3-florida-law-requirements)
4. [Federal Law Requirements](#4-federal-law-requirements)
5. [HIPAA Compliance Requirements](#5-hipaa-compliance-requirements)
6. [SOC 2 Readiness Requirements](#6-soc-2-readiness-requirements)
7. [Security Architecture & Technical Controls](#7-security-architecture--technical-controls)
8. [Functional Requirements](#8-functional-requirements)
9. [Data Classification, Retention & Disposal](#9-data-classification-retention--disposal)
10. [Organizational & Compliance Program](#10-organizational--compliance-program)
11. [Non-Functional Requirements](#11-non-functional-requirements)
12. [Phased Roadmap](#12-phased-roadmap)
13. [Open Questions for Counsel](#13-open-questions-for-counsel)
14. [References](#14-references)
15. [AI-Assisted Development with Claude Agents](#15-ai-assisted-development-with-claude-agents)

---

## 1. Purpose & Scope

### 1.1 Purpose
Build a secure, cloud-hosted SaaS platform that lets Florida physician practices submit, track, and manage insurance claims and denials, enforce Florida prompt-pay and appeal deadlines, and recover revenue lawfully.

### 1.2 In Scope
- Eligibility verification, charge capture, claim scrubbing and submission
- Claim acknowledgment and status tracking
- Remittance (ERA/EOB) posting and payment reconciliation
- Denial capture, categorization, root-cause analysis, and appeals
- Florida prompt-pay deadline tracking and late-payment interest calculation
- Payer overpayment-demand handling and patient refund tracking
- State claim-dispute (AHCA) packet preparation
- Reporting and analytics

### 1.3 Payer Lines of Business to Support
| Line of business | Governing framework | Phase |
|---|---|---|
| Florida-regulated commercial insurers (PPO/EPO/indemnity) | Fla. Stat. ch. 627 | 1 |
| Florida-licensed HMOs | Fla. Stat. ch. 641 | 1 |
| Medicare (Part B, via MAC — First Coast Service Options for FL) | CMS / 42 CFR | 1 |
| Medicare Advantage | 42 CFR Part 422 + plan contract | 1 |
| Florida Medicaid (FFS + Statewide Medicaid Managed Care) | Fla. Stat. ch. 409 + AHCA | 2 |
| Self-funded ERISA plans | Federal ERISA (Florida prompt-pay generally preempted) | 2 |
| Workers' compensation | Fla. Stat. 440.13 + Rule 69L-7, F.A.C. | 3 (optional) |
| Auto PIP (no-fault) | Fla. Stat. 627.736 | 3 (optional) |

> **Design note:** The rules engine must identify the *regulatory regime* of each claim (FL-insured vs. self-funded ERISA vs. Medicare vs. Medicaid), because Florida prompt-pay timelines do **not** apply to self-funded ERISA plans or Medicare.

---

## 2. Regulatory Role Determination

Our legal role determines our obligations. This must be settled with counsel **before** architecture is finalized.

| Scenario | Our HIPAA role | Consequence |
|---|---|---|
| We host software; practices and their clearinghouse do the X12 conversion | **Business Associate (BA)** of each practice | Sign a BAA with every customer; full Security Rule applies to us |
| We convert non-standard data into standard X12 transactions (or vice versa) | **Health Care Clearinghouse = Covered Entity** | Privacy Rule applies directly to us, in addition to Security Rule |
| We use a third-party clearinghouse (e.g., Availity, Waystar, Change/Optum) | We are a BA; clearinghouse is our **subcontractor BA** | Need downstream BAA with clearinghouse |
| We perform billing services (staff work claims on behalf of practices) | Business Associate + billing agent | Medicare billing-agent rules on compensation apply (42 CFR 424.73) |

**Requirement R-2.1:** Document the chosen role in a Regulatory Role Memo signed off by counsel.
**Requirement R-2.2:** Default posture: operate as a **Business Associate** and route X12 through a contracted clearinghouse under a subcontractor BAA.

---

## 3. Florida Law Requirements

### 3.1 Prompt Payment of Claims — Insurers (Fla. Stat. § 627.6131) and HMOs (Fla. Stat. § 641.3155)

These are the core deadlines the product must track. HMO timelines in § 641.3155 closely mirror § 627.6131; configure them as separate rule sets.

**Electronic claims (payer obligations):**
| Event | Deadline | Source |
|---|---|---|
| Payer electronic acknowledgment of receipt | Within 24 hours after the beginning of the next business day after receipt | § 627.6131(4)(a) |
| Payer must pay, or notify provider that claim is denied or contested | 20 days after receipt | § 627.6131(4)(b) |
| Provider must submit additional information requested on a contested claim | 35 days after receipt of the payer's notice ⚠️ VERIFY | § 627.6131(4)(c) |
| Payer must pay or deny | 90 days after receipt | § 627.6131(4)(e) |
| Failure to pay or deny | 120 days after receipt creates an **uncontestable obligation to pay** | § 627.6131(4)(e) |

**Paper (non-electronic) claims (payer obligations):**
| Event | Deadline | Source |
|---|---|---|
| Acknowledgment of receipt (or electronic status access) | 15 days | § 627.6131(5)(a) |
| Pay, deny, or contest | 40 days | § 627.6131(5)(b) |
| Pay or deny | 120 days; uncontestable at 140 days ⚠️ VERIFY | § 627.6131(5) |

**Provider-side obligations:**
| Obligation | Deadline | Source |
|---|---|---|
| Submit initial claim to insurer | Within 6 months after date of service/discharge, subject to listed exceptions ⚠️ VERIFY | § 627.6131(2) |
| Submit to secondary payer | Within 90 days after primary payer's final determination | § 627.6131(2) |
| No duplicate claims unless original was lost/not received | — | § 627.6131(2)(c) |
| Respond to payer overpayment demand | 40 days after receipt of payer's overpayment claim ⚠️ VERIFY | § 627.6131(6) |

**Other requirements:**
- **Late-payment interest:** overdue payments accrue interest (statutory rate 12% per year) ⚠️ VERIFY current rate and accrual start.
- **Payer overpayment recovery window:** payer must submit overpayment claims within 30 months after payment ⚠️ VERIFY.
- **Retroactive denial for ineligibility:** limited after 1 year from payment ⚠️ VERIFY (§ 627.6131(11)).
- **Regulatory audit standard:** OIR measures payer compliance using a 5% permissible error ratio; our reporting should let practices document payer violations for OIR complaints.

**System requirements:**
- **R-3.1.1** Prompt-pay clock engine that starts on documented receipt date (use 999/277CA acknowledgment timestamps as evidence).
- **R-3.1.2** Automatic alerts at Day 15, Day 20, Day 60, Day 90, and Day 120 for electronic claims (configurable).
- **R-3.1.3** Automatic interest calculation on late payments, with an itemized interest-due worksheet per claim.
- **R-3.1.4** Flag claims that reach "uncontestable obligation" status and generate a demand letter.
- **R-3.1.5** Timely-filing guardrail that blocks/warns before the 6-month submission window closes.
- **R-3.1.6** Overpayment-demand inbox with a 40-day response clock and 30-month look-back validation.
- **R-3.1.7** Evidence package export (timestamps, acknowledgments, correspondence) for OIR complaints.

### 3.2 Statewide Provider and Health Plan Claim Dispute Resolution Program (Fla. Stat. § 408.7057)
- AHCA contracts with an independent dispute resolution organization to resolve claim disputes between providers and health plans.
- **R-3.2.1** Generate a dispute-resolution packet (claim history, payer correspondence, contract terms, prompt-pay timeline).
- **R-3.2.2** Track eligibility thresholds and filing deadlines ⚠️ VERIFY current dollar thresholds, filing windows, and excluded claim types (e.g., Medicare, self-funded ERISA).

### 3.3 Offshore Data Storage Ban (Fla. Stat. § 408.051(3), from SB 264, effective July 1, 2023) — **CRITICAL**
- Florida health care providers using certified EHR technology must ensure that all patient information stored offsite — including by third parties, subcontractors, and cloud providers — is **physically maintained in the continental United States, its territories, or Canada**.
- AHCA licensees must attest to compliance **under penalty of perjury** at initial licensure and every renewal (§ 408.810). Our customers will ask us to back that attestation.
- § 408.810 also restricts licensees' relationships with entities tied to "foreign countries of concern."

**System requirements:**
- **R-3.3.1** All production data, backups, replicas, logs containing PHI, analytics copies, and disaster-recovery sites located in **U.S. regions only** (Canada permitted by law, but default to U.S.-only).
- **R-3.3.2** Cloud org policies (e.g., AWS SCPs / Azure Policy / GCP Org Policy) that **deny** resource creation outside approved U.S. regions.
- **R-3.3.3** No PHI access by offshore personnel or offshore subcontractors (support, dev, QA, coding, AR follow-up). Default: U.S.-based workforce only for PHI access.
- **R-3.3.4** All subprocessors contractually bound to U.S. data residency; maintain a public subprocessor list with locations.
- **R-3.3.5** Customer-facing **Data Residency Attestation** letter available for practices' AHCA affidavits.
- **R-3.3.6** Vendor due-diligence screening for ownership ties to foreign countries of concern.
- **R-3.3.7** Third-party AI/LLM services used on PHI must process and store data in U.S. regions under a BAA.

### 3.4 Florida Information Protection Act — FIPA (Fla. Stat. § 501.171)
- Requires "reasonable measures" to protect personal information and secure disposal.
- **Individual notice:** no later than **30 days** after determination of a breach (one 15-day extension possible with good cause).
- **Florida Department of Legal Affairs (Attorney General):** notice if **500 or more** Florida residents affected.
- **Consumer reporting agencies:** notice if **more than 1,000** individuals affected.
- **Third-party agents** (that's us, as a vendor) must notify the covered entity within **10 days** of determining a breach.
- HIPAA-compliant breach notice may satisfy FIPA's individual-notice requirement, but a copy must still go to the Department of Legal Affairs where applicable ⚠️ VERIFY.
- Civil penalties can reach $500,000 per breach (enforced as a FDUTPA violation).

**System requirements:**
- **R-3.4.1** Incident response plan with a **dual clock**: HIPAA (60 days max) and FIPA (30 days). The shorter FIPA clock governs for Florida residents.
- **R-3.4.2** Contractual commitment to notify customers of suspected breaches within **72 hours** (well inside FIPA's 10-day vendor window).
- **R-3.4.3** Ability to query affected-individual counts by state of residence within 24 hours of an incident.
- **R-3.4.4** Pre-drafted notice templates (individual, AG, CRAs, HHS, media).

### 3.5 Patient Records & Sensitive Data Categories
| Law | Requirement | System implication |
|---|---|---|
| § 456.057 | Confidentiality of patient records held by practitioners; limits on disclosure without authorization | Consent/authorization tracking; disclosure logging |
| Rule 64B8-10.002, F.A.C. | Physicians retain medical records at least 5 years after last patient contact | Retention policy (see §9) |
| § 381.004 | HIV test results — heightened confidentiality | Sensitive-data tagging; restricted access |
| § 394.4615 | Mental health clinical records confidentiality | Sensitive-data tagging |
| § 397.501 | Substance abuse treatment records (plus federal 42 CFR Part 2) | Segmented storage; redisclosure notices |
| § 760.40 | Genetic (DNA) test results confidentiality | Sensitive-data tagging |
| § 381.026 | Florida Patient's Bill of Rights | Patient-facing billing communications |

- **R-3.5.1** Field- and record-level **sensitivity tags** (HIV, mental health, SUD, genetic, minors, reproductive health) that drive stricter access control, audit, and masking.
- **R-3.5.2** Suppression of sensitive diagnosis codes from patient statements and non-essential workflows.

### 3.6 Patient Overpayment Refunds (Fla. Stat. § 456.0625, SB 1808, effective January 1, 2026)
- Practitioners and AHCA-licensed facilities must refund a **patient's** overpayment within **30 days** after determining an overpayment occurred, when the claim was submitted to a government program or a private insurer/HMO. Applies to billing departments and management companies accepting payment on the practitioner's behalf.
- Failure can lead to discipline and fines. Does not cover insurer overpayments.

**System requirements:**
- **R-3.6.1** Automatic credit-balance detection after ERA posting.
- **R-3.6.2** "Overpayment determined" date stamp and a 30-day refund clock with escalation at Day 20 and Day 27.
- **R-3.6.3** Refund workflow with approval, issuance record, and audit trail.
- **R-3.6.4** Aging report of open patient credit balances.

### 3.7 Balance Billing & Surprise Billing
- Florida: §§ 627.64194 (PPO/EPO emergency and certain non-emergency services), 641.513 and 641.3154 (HMO — provider may not bill HMO members for covered services).
- Federal: No Surprises Act (see §4).
- **R-3.7.1** Block patient statements for amounts prohibited from balance billing (HMO covered services; protected emergency/out-of-network scenarios).
- **R-3.7.2** Flag out-of-network claims for Florida vs. federal IDR pathway selection ⚠️ VERIFY interaction rules.

### 3.8 Prior Authorization & Step Therapy
- § 627.42392: payers without an electronic process must use the state-approved prior authorization form (max 2 pages).
- § 627.42393: step-therapy protocols and exceptions.
- **R-3.8.1** Track authorization numbers per service line and link to claims; auto-flag denials with auth-related CARCs.
- **R-3.8.2** Store PA forms and payer decisions as appeal evidence.

### 3.9 Medical Debt & Patient Collections
- **HB 7089 (Ch. 2024-183), effective July 1, 2024:** 3-year statute of limitations for actions on medical debt owed to hospitals and ASCs (from date of referral to a third party), limits on "extraordinary collection actions," grievance-process requirements, and good-faith estimate duties. Mainly facility-focused, but relevant if we serve ASCs.
- **Florida Consumer Collection Practices Act (§§ 559.55–559.785):** applies to consumer debt collection, including original creditors; consumer collection agencies must register with the Office of Financial Regulation.
- **R-3.9.1** If patient collections are in scope, restrict communication times/channels, log all contacts, and support dispute holds.
- **R-3.9.2** Hold collections while an insurance appeal or grievance is pending.
- **R-3.9.3** Decide whether we perform collections (registration likely required) or only generate statements ⚠️ VERIFY.

### 3.10 Fraud, Abuse & Billing Integrity
| Law | Topic |
|---|---|
| § 817.234 | Insurance fraud (false/misleading claims) |
| § 456.072 | Grounds for practitioner discipline (includes improper billing) |
| § 409.913 / § 409.920 | Medicaid program integrity and Medicaid fraud |
| §§ 68.081–68.092 | Florida False Claims Act |
| § 456.054 | Kickbacks |
| § 817.505 | Patient brokering |
| § 458.331(1)(i) | Fee splitting (relevant to percentage-based billing fees) ⚠️ VERIFY |

- **R-3.10.1** No automated feature may upcode, unbundle, or alter clinical codes without documented clinician/coder approval.
- **R-3.10.2** AI-suggested code or appeal changes require **human review and attestation**, logged with user ID and timestamp.
- **R-3.10.3** Immutable claim-version history (every edit, who, when, why).
- **R-3.10.4** Pricing model reviewed by counsel for fee-splitting and Medicare billing-agent compliance.

### 3.11 Florida Medicaid (Phase 2)
- Statewide Medicaid Managed Care (SMMC) plans are governed by § 409.967 and AHCA plan contracts; FFS by AHCA's Florida Medicaid handbooks.
- **R-3.11.1** Separate rule sets per SMMC plan (timely filing, appeal windows, dispute process) ⚠️ VERIFY each plan contract.
- **R-3.11.2** Medicaid record retention per § 409.913 ⚠️ VERIFY period.

### 3.12 Electronic Records & Signatures
- Florida Uniform Electronic Transaction Act (§ 668.50): e-signatures on appeals, attestations, and BAAs are enforceable.
- **R-3.12.1** E-signature with signer identity, intent, timestamp, and tamper-evident document hash.

### 3.13 Operating a Business in Florida
- **R-3.13.1** Register the entity with the Florida Division of Corporations (Sunbiz) or register as a foreign entity; maintain a Florida registered agent.
- **R-3.13.2** Confirm Florida sales/use tax treatment of the SaaS offering ⚠️ VERIFY with a tax advisor.
- **R-3.13.3** Customer contracts governed by Florida law with Florida venue (or as negotiated).
- **R-3.13.4** If selling to Florida government entities: comply with § 287.138 (foreign country of concern restrictions) and Florida public records considerations.
- **R-3.13.5** Florida Digital Bill of Rights (§§ 501.701 et seq.) likely does not apply (high revenue thresholds; HIPAA-covered data largely exempt) ⚠️ VERIFY.

---

## 4. Federal Law Requirements

### 4.1 HIPAA Administrative Simplification — Transactions & Code Sets
| Transaction | Standard | Purpose |
|---|---|---|
| Professional claim | X12 837P (005010X222A1) | Claim submission |
| Institutional claim | X12 837I (005010X223A2) | If facilities supported |
| Remittance advice | X12 835 | ERA posting |
| Claim status | X12 276/277 | Status inquiry |
| Eligibility | X12 270/271 | Coverage verification |
| Prior auth | X12 278 | Authorization |
| Acknowledgments | X12 999, 277CA | Receipt/acceptance evidence |

- **Code sets:** ICD-10-CM, CPT (**requires an AMA license** for distribution in software), HCPCS Level II, CARC/RARC (X12), CMS POS codes, NDC.
- **Edits:** NCCI PTP and MUE edits, LCD/NCD coverage rules for Medicare (First Coast).
- **Identifiers:** NPI (individual and group), TIN, taxonomy codes.
- **Operating rules:** CAQH CORE (EFT/ERA enrollment, reassociation).

### 4.2 Medicare
- Timely filing: 12 months from date of service.
- Appeal levels: Redetermination (120 days) → Reconsideration/QIC (180 days) → ALJ (60 days) → Medicare Appeals Council (60 days) → Federal district court (60 days). Amount-in-controversy thresholds update annually.
- ABN (Form CMS-R-131) tracking for non-covered services; current form version required.
- **R-4.2.1** Medicare appeal workflow with all five levels and deadline tracking.

### 4.3 No Surprises Act
- Good-faith estimates for uninsured/self-pay patients; patient-provider dispute resolution; federal IDR for out-of-network disputes.
- **R-4.3.1** GFE generation and storage; IDR deadline tracking (open negotiation 30 business days, then IDR initiation window) ⚠️ VERIFY current timelines.

### 4.4 CMS Interoperability & Prior Authorization Final Rule (CMS-0057-F)
- Applies to MA, Medicaid/CHIP managed care and FFS, and QHPs on the FFE. Decision timeframes (72 hours expedited / 7 calendar days standard) in effect since January 2026; Prior Authorization API and related APIs required starting January 2027.
- **R-4.4.1** Roadmap support for FHIR-based Prior Authorization API (Da Vinci CRD/DTR/PAS) integration.

### 4.5 42 CFR Part 2 (Substance Use Disorder Records)
- 2024 final rule aligned Part 2 more closely with HIPAA; compliance date February 16, 2026.
- **R-4.5.1** Segment Part 2 data; enforce consent and redisclosure restrictions; mark records.

### 4.6 Other Federal
- **HITECH Act** — breach notification and enhanced penalties.
- **Federal False Claims Act, Anti-Kickback Statute, Stark Law** — billing integrity.
- **FDCPA / TCPA** — if patient collections, calls, or texts are performed.
- **21st Century Cures Act information blocking** — relevant if we become a certified health IT developer or HIN/HIE ⚠️ VERIFY.
- **FTC Act § 5** — accurate security and privacy marketing claims.

---

## 5. HIPAA Compliance Requirements

### 5.1 Privacy Rule (as BA — obligations flow through the BAA)
- Use/disclose PHI only as permitted by the BAA; apply **minimum necessary**.
- Support customers' patient rights: access, amendment, accounting of disclosures.
- **R-5.1.1** Accounting-of-disclosures log exportable per patient.
- **R-5.1.2** Minimum-necessary role design: billing staff see billing data, not full clinical notes, unless needed for an appeal.

### 5.2 Security Rule (45 CFR Part 164, Subpart C)

**Administrative safeguards**
- Written **risk analysis** (annual and on major change) and risk management plan
- Designated **Security Officer** and **Privacy Officer**
- Workforce security, onboarding/offboarding, sanction policy
- Security awareness training (onboarding + annual + phishing simulations)
- Security incident procedures
- Contingency plan: backup, DR, emergency mode operations, testing
- Periodic evaluation
- BAAs with all subcontractors that touch PHI

**Physical safeguards**
- Inherited from cloud provider (documented via their SOC 2 / HITRUST reports)
- Workstation security policy, full-disk encryption on all endpoints, MDM
- Device and media controls: disposal, re-use, inventory

**Technical safeguards**
- Unique user IDs, emergency access procedure, automatic logoff, encryption
- Audit controls (log all PHI access)
- Integrity controls (hashing, versioning)
- Person/entity authentication (MFA)
- Transmission security (TLS)

### 5.3 Pending HIPAA Security Rule Overhaul — **Build to it now**
The January 2025 NPRM is **still proposed as of September 2026** (HHS target for a final rule has moved to roughly mid-2027). It would remove the "addressable" distinction. We will treat its core controls as **mandatory baseline** today:

| Proposed control | Our baseline |
|---|---|
| Encryption of ePHI at rest and in transit | Required (see §7.3) |
| MFA for all access to systems with ePHI | Required (see §7.2) |
| Written asset inventory and network map, reviewed annually | Required |
| Vulnerability scanning every 6 months | We exceed: continuous/weekly |
| Annual penetration testing | Required |
| Patch critical within 15 days, high within 30 days | Required |
| Terminate workforce access within 1 hour of separation | Required |
| Restore critical systems within 72 hours | Required (RTO ≤ 4h target) |
| Network segmentation | Required |
| Annual compliance audit | Covered by SOC 2 Type II |
| BA notification of contingency-plan activation within 24 hours | Required in customer BAA |

### 5.4 Breach Notification Rule
- Notify covered entity (customer) without unreasonable delay, max 60 days (our contract: **72 hours**).
- Customer notifies individuals (≤60 days), HHS, and media (500+ in a state).
- 4-factor risk assessment documented for every incident.

### 5.5 Business Associate Agreements
- **R-5.5.1** Standard BAA template reviewed by counsel, including: U.S. data residency (§ 408.051), 72-hour breach notice, FIPA cooperation, subcontractor flow-down, return/destruction on termination, audit rights, and cyber-insurance minimums.
- **R-5.5.2** Signed **downstream BAAs** with: cloud provider, clearinghouse, email/SMS provider, logging/SIEM vendor, backup vendor, support/ticketing tool, AI/LLM provider, e-signature vendor, and any offshore-free outsourced staff.

---

## 6. SOC 2 Readiness Requirements

### 6.1 Scope
| Trust Services Category | Include? | Rationale |
|---|---|---|
| Security (Common Criteria) | **Required** | Mandatory for SOC 2 |
| Availability | **Yes** | Practices depend on uptime for cash flow |
| Confidentiality | **Yes** | PHI, payer contracts, fee schedules |
| Processing Integrity | **Yes** | Claims must be complete, accurate, timely — core to the product |
| Privacy | Optional (Phase 2) | HIPAA controls cover much of this |

### 6.2 Path
1. Readiness assessment and gap analysis (month 0–2)
2. Implement controls and a compliance automation platform (e.g., Vanta, Drata, Secureframe) (month 1–4)
3. **SOC 2 Type I** audit (point in time) (month 4–5)
4. Observation window, 3–6 months minimum
5. **SOC 2 Type II** audit (month 9–12), then annually
6. Optional: HITRUST r2 if enterprise/health-system customers require it

### 6.3 Control Domains (mapped to AICPA TSC Common Criteria)
| Domain | Key controls |
|---|---|
| CC1 Control environment | Code of conduct, org chart, background checks, board/management oversight |
| CC2 Communication | Security policies published, customer-facing security page, incident contact |
| CC3 Risk assessment | Annual risk assessment, fraud risk, vendor risk |
| CC4 Monitoring | Internal audits, control monitoring, SIEM alerting |
| CC5 Control activities | Policies mapped to controls, segregation of duties |
| CC6 Logical & physical access | SSO, MFA, RBAC, quarterly access reviews, encryption, offboarding |
| CC7 System operations | Vulnerability mgmt, IDS, incident response, logging |
| CC8 Change management | PR reviews, CI/CD approvals, separate environments, change tickets |
| CC9 Risk mitigation | Vendor management, BAAs, cyber insurance |
| A1 Availability | Capacity planning, backups, DR tests |
| C1 Confidentiality | Data classification, secure disposal |
| PI1 Processing integrity | Input validation, claim reconciliation, error handling, output completeness checks |

### 6.4 Required Policies (minimum set)
Information Security Policy · Acceptable Use · Access Control · Encryption & Key Management · Data Classification & Handling · Data Retention & Disposal · Change Management · Secure SDLC · Vulnerability & Patch Management · Incident Response · Breach Notification (HIPAA + FIPA) · Business Continuity & Disaster Recovery · Vendor/Third-Party Risk Management · Risk Assessment · Asset Management · Logging & Monitoring · Physical Security · HR Security (background checks, onboarding/offboarding, sanctions) · Security Awareness Training · Privacy Policy · HIPAA Privacy & Security Policies · Data Residency Policy (§ 408.051) · AI Use Policy.

---

## 7. Security Architecture & Technical Controls

### 7.1 Hosting
- **R-7.1.1** HIPAA-eligible cloud (AWS, Azure, or GCP) under a signed BAA; only HIPAA-eligible services used for PHI.
- **R-7.1.2** U.S.-only regions enforced by org policy (primary + secondary U.S. region for DR; Azure East US 2 / Central US proposed in ADR 0002).
- **R-7.1.3** Separate accounts/projects for prod, staging, dev; **no PHI outside production** (synthetic data in lower environments).
- **R-7.1.4** Infrastructure as Code (Terraform/CDK) with policy-as-code checks.

### 7.2 Identity & Access
- **R-7.2.1** SSO (SAML 2.0 / OIDC) for customers and workforce; SCIM provisioning.
- **R-7.2.2** MFA required for all users; **phishing-resistant MFA (FIDO2/WebAuthn)** required for admins and workforce with PHI access.
- **R-7.2.3** Role-based + attribute-based access control scoped by tenant, practice, location, and provider.
- **R-7.2.4** Strict **multi-tenant isolation** (tenant ID enforced at the data layer, e.g., row-level security; tested every release).
- **R-7.2.5** Just-in-time, time-boxed privileged access with approval and session recording.
- **R-7.2.6** Break-glass accounts with alerts and after-the-fact review.
- **R-7.2.7** Session timeout: 15 minutes idle (configurable down), absolute session limit 12 hours.
- **R-7.2.8** Quarterly access reviews; access removed within 1 hour of workforce termination.
- **R-7.2.9** Password policy per NIST SP 800-63B (length over complexity, breached-password screening).

### 7.3 Encryption & Key Management
- **R-7.3.1** TLS 1.2+ (prefer 1.3) for all traffic, HSTS, no weak ciphers; internal service-to-service traffic encrypted (mTLS).
- **R-7.3.2** AES-256 encryption at rest for databases, object storage, backups, queues, and logs.
- **R-7.3.3** Field-level/application-layer encryption for high-risk identifiers: SSN, Medicare Beneficiary Identifier, member IDs, bank account data.
- **R-7.3.4** Customer-managed keys in cloud KMS/HSM; annual rotation; separation of duties for key admins.
- **R-7.3.5** Secrets in a secrets manager; no secrets in code, images, or environment files; secrets scanning in CI.

### 7.4 Application Security (Secure SDLC)
- **R-7.4.1** OWASP ASVS Level 2 as the application security standard; OWASP Top 10 and API Top 10 addressed.
- **R-7.4.2** SAST, SCA (dependency scanning), DAST, container and IaC scanning in CI; builds fail on critical findings.
- **R-7.4.3** SBOM generated for each release.
- **R-7.4.4** Mandatory peer code review; protected main branch; signed commits/artifacts.
- **R-7.4.5** Threat modeling for each major feature (STRIDE).
- **R-7.4.6** Input validation for all X12, CSV, PDF, and image uploads; malware scanning of attachments.
- **R-7.4.7** Rate limiting, WAF, and bot protection on public endpoints.
- **R-7.4.8** No PHI in URLs, client-side logs, analytics tools, error trackers, or crash reports.

### 7.5 Logging, Monitoring & Audit
- **R-7.5.1** Immutable (WORM) audit log of every PHI view, create, update, export, print, and delete: who, what, when, where (IP/device), why (where captured).
- **R-7.5.2** Audit logs retained at least **6 years** (HIPAA documentation standard); recommend 7+.
- **R-7.5.3** Centralized SIEM with alerting on anomalous access (mass export, after-hours access, VIP/employee record access, impossible travel).
- **R-7.5.4** Customer-facing audit log viewer and export for practice compliance officers.
- **R-7.5.5** Log data containing PHI stays in U.S. regions and is covered by a BAA.

### 7.6 Vulnerability Management
| Severity | Remediation SLA |
|---|---|
| Critical | 15 days (7 days if actively exploited) |
| High | 30 days |
| Medium | 90 days |
| Low | Best effort / next cycle |

- **R-7.6.1** Continuous/weekly authenticated scanning; annual third-party penetration test plus test after major releases.
- **R-7.6.2** Public vulnerability disclosure policy (security.txt).

### 7.7 Network Security
- Private subnets for data tiers; no public database endpoints.
- Network segmentation between tenants' processing workloads where feasible, and between PHI and non-PHI systems.
- Egress filtering; private connectivity to cloud services (VPC endpoints / Private Link).
- DDoS protection.

### 7.8 Endpoint & Workforce Security
- MDM-managed devices only for PHI access; full-disk encryption; EDR; auto screen lock; USB storage blocked.
- No PHI on personal devices or personal email.
- Email security: DMARC (p=reject), SPF, DKIM; encrypted email for PHI.

### 7.9 Backup, Business Continuity & Disaster Recovery
- **R-7.9.1** Encrypted, immutable backups; cross-region copy (U.S. only).
- **R-7.9.2** RPO ≤ 1 hour; RTO ≤ 4 hours for core claim functions (proposed HIPAA rule: 72 hours max).
- **R-7.9.3** Restore tests quarterly; full DR exercise annually; results documented for SOC 2.
- **R-7.9.4** Ransomware playbook; hurricane/regional-outage plan (Florida-relevant for customer operations and support staff).
- **R-7.9.5** Clearinghouse redundancy plan (lesson from the 2024 Change Healthcare outage): ability to switch or dual-route claims.

### 7.10 Incident Response
- **R-7.10.1** Documented IR plan with severity levels, roles, and on-call rotation.
- **R-7.10.2** Clocks tracked from discovery: internal escalation ≤ 1 hour; customer notice ≤ 72 hours; FIPA individual notice ≤ 30 days; HIPAA ≤ 60 days.
- **R-7.10.3** Annual tabletop exercises; retained breach counsel and forensics firm on standby.
- **R-7.10.4** Cyber liability insurance with healthcare breach coverage.

### 7.11 AI / Machine Learning Use (if used for denial prediction, coding suggestions, or appeal drafting)
- **R-7.11.1** AI vendors under BAA, U.S.-region processing, and zero data retention / no training on customer PHI.
- **R-7.11.2** Human-in-the-loop: AI outputs are suggestions; a named user approves before anything is submitted to a payer.
- **R-7.11.3** Model outputs, prompts, and approvals logged for audit.
- **R-7.11.4** Guardrails against code inflation (see R-3.10.1); periodic accuracy and bias review.
- **R-7.11.5** Clear labeling of AI-generated content inside the product.

---

## 8. Functional Requirements

### 8.1 Practice & Payer Setup
- Multi-practice, multi-location, multi-provider tenancy
- Provider credentials: NPI, taxonomy, Florida license number (Board of Medicine / Osteopathic Medicine), DEA where relevant
- Payer master with regulatory regime tag (FL insurer / FL HMO / ERISA self-funded / Medicare / MA / Medicaid FFS / SMMC plan / WC / PIP)
- Contracted fee schedules for underpayment detection
- ERA/EFT enrollment tracking

### 8.2 Claim Lifecycle
1. **Eligibility** (270/271) before or at visit
2. **Charge capture** (manual, EHR integration via HL7 v2/FHIR, or CSV)
3. **Scrubbing** — NCCI, MUE, LCD/NCD, payer-specific rules, missing auth, timely filing check
4. **Submission** via clearinghouse (837P)
5. **Acknowledgment capture** (999, 277CA) — starts the Florida prompt-pay clock
6. **Status tracking** (276/277) with automated follow-up
7. **Remittance posting** (835) with auto-posting and exception queue
8. **Reconciliation** — ERA to bank deposit (EFT reassociation)

### 8.3 Denial Management
- Capture every denial with CARC, RARC, and group code (CO/PR/OA/PI)
- Categorize: eligibility, authorization, coding, medical necessity, timely filing, duplicate, bundling, COB, missing info, credentialing
- Root-cause dashboard by payer, provider, CPT, and denial reason
- Work queues prioritized by dollar value and **days remaining to appeal deadline**
- Corrected claim (frequency code 7) and void (8) support
- Preventable-denial feedback loop into scrubbing rules

### 8.4 Appeals
- **Deadline engine** computing appeal windows per payer regime and plan contract
- Appeal letter templates per denial category and payer, with merge fields and attachment bundling (records, auth, notes)
- Medicare 5-level appeal workflow
- Florida state dispute packet (§ 408.7057) and OIR complaint evidence export
- Tracking of appeal outcomes and overturn rates

### 8.5 Florida-Specific Automation
| Feature | Law |
|---|---|
| Prompt-pay clock and alerts | §§ 627.6131, 641.3155 |
| Late-payment interest calculator and demand letter | §§ 627.6131, 641.3155 |
| Uncontestable-obligation flag | § 627.6131(4)(e) |
| Timely filing guard (6 months) and secondary-payer 90-day guard | § 627.6131(2) |
| Payer overpayment-demand response workflow | § 627.6131(6) |
| Patient refund 30-day tracker | § 456.0625 |
| Balance-billing block | §§ 627.64194, 641.3154 |
| Data residency attestation generator | § 408.051(3) |

### 8.6 Patient Financial Responsibility (optional module)
- Patient statements that suppress sensitive diagnoses
- Good-faith estimates (No Surprises Act)
- Payment plans; online payments via **PCI DSS-compliant** processor (tokenized; we never store card data)
- Collections holds during appeals/grievances

### 8.7 Reporting
- A/R aging by payer and bucket; clean-claim rate; first-pass resolution rate; denial rate; days in A/R; net collection rate
- Payer prompt-pay compliance scorecard (useful for OIR complaints and contract negotiation)
- Underpayment variance report vs. contract
- Compliance reports: access logs, refunds, open credit balances

### 8.8 Integrations
- Clearinghouse (primary + backup)
- EHR/PM systems via FHIR R4 / HL7 v2 / flat files
- Florida Medicaid and payer portals (API where available; no credential sharing that violates payer terms)
- Accounting/banking for reconciliation

---

## 9. Data Classification, Retention & Disposal

### 9.1 Classification
| Class | Examples | Controls |
|---|---|---|
| **Restricted-Sensitive PHI** | HIV, mental health, SUD (Part 2), genetic, reproductive, minors | Extra access restrictions, field encryption, heightened audit |
| **Restricted PHI** | Claims, diagnoses, member IDs, SSN, MBI | Encryption, RBAC, full audit |
| **Confidential** | Payer contracts, fee schedules, customer financials | Encryption, need-to-know |
| **Internal** | Internal docs, non-PHI metrics | Workforce only |
| **Public** | Marketing, public security page | None |

### 9.2 Retention (configurable per customer; defaults below)
| Record | Minimum driver | Platform default |
|---|---|---|
| Claims, remits, appeals | FL physician records 5 yrs (Rule 64B8-10.002); Medicare/MA and False Claims Act exposure longer | **10 years** |
| HIPAA policies, risk analyses, BAAs | 6 years (45 CFR 164.316) | 7 years |
| Audit logs | 6 years | 7 years |
| Florida Medicaid records | § 409.913 ⚠️ VERIFY | 10 years |
| Security incident records | 6 years | 7 years |

- **R-9.2.1** Legal hold capability that overrides deletion.
- **R-9.2.2** Customer data return (standard formats) and certified destruction within 30–90 days of contract termination (per BAA).
- **R-9.2.3** Secure disposal per NIST SP 800-88 and FIPA § 501.171 disposal requirements.

---

## 10. Organizational & Compliance Program

- **R-10.1** Named Security Officer and Privacy Officer (can be fractional early on).
- **R-10.2** Compliance program aligned to the HHS-OIG General Compliance Program Guidance (2023).
- **R-10.3** Background checks for all workforce with PHI access; OIG LEIE and SAM exclusion screening at hire and monthly.
- **R-10.4** HIPAA + security training at onboarding and annually; role-specific training for billing/coding staff.
- **R-10.5** Vendor risk management: security questionnaire, SOC 2 report review, BAA, data residency confirmation, annual reassessment.
- **R-10.6** Insurance: cyber liability, technology E&O, general liability.
- **R-10.7** Retain Florida healthcare regulatory counsel; schedule an **annual Florida legislative review** each spring (after session ends) to update the rules engine before July 1 / October 1 / January 1 effective dates.
- **R-10.8** Customer trust center: security overview, SOC 2 report (under NDA), subprocessor list, BAA, data residency attestation.

---

## 11. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Availability | 99.9% monthly SLA for core app; 99.95% target |
| Performance | P95 page load < 2s; claim scrub < 3s per claim; batch of 10,000 claims < 30 min |
| Scalability | Horizontal scaling; support 500+ practices in year 1 architecture |
| Accessibility | WCAG 2.1 AA |
| Browser support | Current Chrome, Edge, Safari, Firefox |
| Time zone | All legal clocks computed in **America/New_York** (with Central time for the Florida panhandle practices configurable), with business-day and state/federal holiday calendars |
| Data accuracy | Processing-integrity controls: batch totals, control counts, reconciliation between submitted and acknowledged claims |
| Observability | Metrics, traces, logs with PHI redaction |
| Language (**R-11.1**) | The user interface (every screen, menu, message, page title, and export label) is available in English, Spanish, and Portuguese. Each user chooses a language from the user menu; the choice applies at once, is stored on the account, and follows the user to any device. Codes and their official descriptions, statutes, and data the practice entered are not translated. Spec: `docs/specs/internationalization.md` |

---

## 12. Phased Roadmap

| Phase | Timeline | Deliverables |
|---|---|---|
| **0 — Foundation** | Months 0–2 | Regulatory role memo, counsel engaged, cloud BAA, U.S.-only landing zone, policies drafted, risk analysis, compliance automation tool |
| **1 — MVP** | Months 2–6 | Commercial/HMO/Medicare claims, 837P/835/277CA via clearinghouse, denial queues, prompt-pay engine, interest calculator, audit logging, MFA/SSO, SOC 2 Type I |
| **2 — Expansion** | Months 6–12 | Medicaid FFS + SMMC, appeals automation, AHCA dispute packets, patient refunds tracker, analytics, SOC 2 Type II observation → report |
| **3 — Advanced** | Months 12–18 | AI denial prediction (human-in-loop), FHIR Prior Auth API, WC/PIP modules, patient payments, HITRUST (if needed) |

---

## 13. Open Questions for Counsel

1. Are we a Business Associate or a Health Care Clearinghouse under our planned data flows?
2. Does § 408.051(3) restrict **offshore access** (not just storage), and should our contracts prohibit offshore access outright? (Our default: yes, prohibit.)
3. Confirm all § 627.6131 / § 641.3155 subsection numbers, the 35-day provider response period, paper-claim deadlines, interest rate and accrual rules, and the 30-month overpayment window.
4. Current eligibility thresholds and filing windows for the § 408.7057 dispute program.
5. Does our pricing model (flat vs. percentage of collections) raise fee-splitting or Medicare billing-agent issues?
6. If we generate patient statements or contact patients, do we need to register as a consumer collection agency under Chapter 559?
7. Florida sales tax treatment of our SaaS and any billing-service component.
8. Required terms in customer BAAs to support practices' AHCA data-residency affidavits.
9. Applicability of any 2026 Florida legislative changes affecting claims, prior authorization, or health data (review each session's enacted bills).
10. Treatment of reproductive health information after the 2024 HIPAA reproductive health privacy rule was vacated (2025), under Florida law.

---

## 14. References

**Florida**
- Fla. Stat. § 627.6131 — Payment of claims (insurers): https://www.flsenate.gov/Laws/Statutes/2024/627.6131
- Fla. Stat. § 641.3155 — Prompt payment of claims (HMOs)
- Fla. Stat. § 408.7057 — Statewide Provider and Health Plan Claim Dispute Resolution Program
- Fla. Stat. § 408.051(3) and § 408.810 — Offshore storage ban (SB 264, 2023)
- Fla. Stat. § 501.171 — Florida Information Protection Act
- Fla. Stat. § 456.0625 — Patient overpayment refunds (SB 1808, 2025): https://www.flsenate.gov/Session/Bill/2025/1808
- HB 7089 (2024), Ch. 2024-183 — Medical debt and transparency: https://flsenate.gov/Session/Bill/2024/7089
- Fla. Stat. §§ 456.057, 381.004, 394.4615, 397.501, 760.40 — Records confidentiality
- Fla. Stat. §§ 627.42392, 627.42393 — Prior authorization, step therapy: https://www.flsenate.gov/laws/statutes/2025/627.42392
- Fla. Stat. §§ 627.64194, 641.3154, 641.513 — Balance billing
- Fla. Stat. §§ 559.55–559.785 — Florida Consumer Collection Practices Act
- Fla. Stat. §§ 817.234, 456.072, 409.913, 68.081–68.092 — Fraud and program integrity
- Rule 64B8-10.002, F.A.C. — Physician medical records retention

**Federal**
- HIPAA Privacy, Security, and Breach Notification Rules — 45 CFR Parts 160, 162, 164
- HIPAA Security Rule NPRM (Jan. 6, 2025) — still proposed as of Sept. 2026
- 42 CFR Part 2 — SUD records (compliance date Feb. 16, 2026)
- CMS Interoperability & Prior Authorization Final Rule (CMS-0057-F)
- No Surprises Act (Consolidated Appropriations Act, 2021)
- AICPA Trust Services Criteria (SOC 2)
- NIST SP 800-53, 800-63B, 800-88, 800-66r2 (HIPAA Security Rule implementation guide)
- OWASP ASVS 4.x

---

## 15. AI-Assisted Development with Claude Agents

This platform will be built with Claude (Claude Code) using a defined set of specialized subagents. Because AI-assisted development is part of our SDLC, it is in scope for SOC 2 change management (CC8), and the rules below are binding requirements.

### 15.1 Agent Roster
Agent definitions live in the repository at `.claude/agents/*.md`, and project-wide rules live in `CLAUDE.md` at the repo root.

| Agent | Role | Writes code? | Model |
|---|---|---|---|
| `solution-architect` | Architecture, ADRs, data model, service boundaries, threat models | Docs only | opus |
| `backend-engineer` | APIs, domain services, database, multi-tenant isolation | Yes | sonnet |
| `frontend-engineer` | Web UI, work queues, accessibility, PHI-safe client behavior | Yes | sonnet |
| `edi-x12-specialist` | 837P/835/270/271/276/277/278/999/277CA parsing, generation, clearinghouse integration | Yes | sonnet |
| `florida-rules-engine` | Encodes Florida and federal deadlines as versioned, effective-dated rules | Yes (rules + tests) | opus |
| `devops-infrastructure` | Terraform/IaC, U.S.-only regions, CI/CD, observability | Yes (IaC) | sonnet |
| `qa-test-engineer` | Unit, integration, E2E, tenant-isolation, and rules-engine tests on synthetic data | Yes (tests) | sonnet |
| `security-reviewer` | Read-only security review of every PR against §7 | No | opus |
| `hipaa-compliance-reviewer` | Read-only review against HIPAA, § 408.051, FIPA, and Florida law | No | opus |
| `soc2-evidence-auditor` | Maps changes to SOC 2 controls; maintains evidence index and policies | Docs only | sonnet |
| `technical-writer` | API docs, runbooks, trust-center content, release notes | Docs only | haiku |

> **Implementation note (2026-09-26):** the roles above are covered by 8 agents in `.claude/agents/`:
> `spec-writer`, `architect`, `builder`, `florida-rules-engine`, `edi-x12-specialist`, `reviewer`,
> `security-reviewer`, `compliance-checker`. The mapping is in `docs/AGENT_WORKFLOW.md`.

### 15.2 Standard Workflow per Feature
1. **Plan:** `solution-architect` writes or updates the ADR and threat model and lists the requirement IDs (R-x.x) involved.
2. **Build:** engineering agents implement the change. `florida-rules-engine` owns every legal deadline or calculation.
3. **Test:** `qa-test-engineer` adds tests. Every legal rule gets boundary tests for the day before, the day of, and the day after each deadline.
4. **Review:** `security-reviewer` and `hipaa-compliance-reviewer` run on the diff. Blocking findings must be fixed before a human reviews the change.
5. **Evidence:** `soc2-evidence-auditor` records which controls the change touches.
6. **Human approval:** a named human engineer reviews and approves the PR. **No agent may merge to main or deploy to production.**

### 15.3 Guardrails (Mandatory)
- **R-15.1 No real PHI in agent sessions.** Agents work only with synthetic data (e.g., Synthea-generated patients and fake member IDs). Production data, production credentials, and production consoles are never exposed to agents.
- **R-15.2** Claude may process PHI (for example, through AI features in the product itself) only under a signed **BAA with Anthropic** on an eligible plan or API configuration, and the processing location must satisfy § 408.051(3). ⚠️ VERIFY with Anthropic before any use of PHI.
- **R-15.3 Least privilege for agents.** Reviewer agents are read-only. No agent can access production secrets, production cloud accounts, or customer tenants.
- **R-15.4 Traceability.** Every commit and PR references the requirement IDs it implements (e.g., `R-3.1.3`), and agent-authored commits are labeled as AI-assisted.
- **R-15.5 Human accountability.** A human is the accountable author of record for every merged change. Branch protection requires at least one human approval and passing security and compliance checks.
- **R-15.6 No legal deadlines in code.** Statutory values live only in the rules engine, each with a citation, an effective date, and a ⚠️ VERIFY flag until counsel confirms it.
- **R-15.7 Dependency hygiene.** Agents may not add dependencies without SCA scanning and license review, and must never add unvetted packages suggested from memory.
- **R-15.8 Session logs.** Agent session transcripts for security-relevant changes are retained as change-management evidence.
- **R-15.9 Scope of autonomy.** Agents may open PRs, run tests, and run scanners. They may not change IAM, branch protection, or audit-logging configuration without explicit human sign-off in the PR.
