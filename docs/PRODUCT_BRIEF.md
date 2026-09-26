# DenialDesk — product brief

> This document drives every agent's work. Detailed, citable requirements live in
> `docs/REQUIREMENTS.md`; this brief says what the product is and what the MVP includes.
> Items marked `TODO` still need a human answer.

## Problem
Florida physician practices lose revenue on claims that are denied, underpaid, or paid late.
Claims are worked by hand across payer portals, spreadsheets, and email. Practices miss appeal
and timely-filing deadlines, rarely enforce Florida prompt-pay law (interest on late payments,
uncontestable obligations), rework the same denial types, and can't see which claims are worth
the effort.

## Product
A secure, multi-tenant SaaS platform for Florida physician practices to submit, track, and
manage insurance claims and denials, enforce Florida prompt-pay and appeal deadlines, and
recover revenue lawfully. Built and previewed on Netlify with synthetic data only (ADR 0003);
production runs on Microsoft Azure in U.S. regions only (ADR 0002).

## Users
- **Biller / denial specialist** — submits claims, works denial and follow-up queues day to day.
- **RCM manager** — watches A/R, denial rate, recovery, and staff workload.
- **Practice administrator** — sets up practice, providers, payers, users.
- **Practice compliance officer** — reviews audit logs, refunds, and payer-violation evidence.
- TODO: clinicians signing medical-necessity appeals? outside billing companies as tenants?

## MVP (Phase 1 in `docs/ROADMAP.md`, R-12)
Payer lines: Florida-regulated commercial insurers (ch. 627), Florida HMOs (ch. 641),
Medicare Part B (First Coast), Medicare Advantage.

1. **Set up** practices, locations, providers (NPI, taxonomy), and payers tagged with their
   regulatory regime (FL insurer / FL HMO / ERISA self-funded / Medicare / MA).
2. **Submit** claims (837P) through a contracted clearinghouse, after a timely-filing check.
3. **Capture acknowledgments** (999, 277CA); the 277CA receipt date starts the prompt-pay clock.
4. **Track prompt-pay** deadlines with alerts, late-payment interest worksheets, and
   uncontestable-obligation flags (FL-regulated claims only).
5. **Post remittances** (835) and capture every denial with CARC, RARC, and group code.
6. **Work denials** in queues prioritized by dollar value and days left to the appeal deadline.
7. **Appeal** with templated letters (human-reviewed), corrected/void claims, and outcome tracking.
8. **Prove it**: immutable audit log, claim version history, and evidence export for OIR complaints.

Security baseline for the MVP: SSO + MFA, tenant isolation, encryption, audit logging
(R-7.2, R-7.3, R-7.5), and a SOC 2 Type I audit.

## Out of scope for MVP
- Florida Medicaid (FFS + SMMC), self-funded ERISA workflows, AHCA dispute packets,
  patient refund tracker (Phase 2)
- AI denial prediction and AI-drafted appeals, FHIR prior-auth API, workers' comp / PIP,
  patient payments and collections (Phase 3)
- Direct submission to payer portals; EHR integrations beyond CSV/flat-file import

## Constraints
- Business Associate posture; clearinghouse under a subcontractor BAA (R-2.2).
- U.S.-only data residency and workforce PHI access (R-3.3).
- All legal deadlines live in a versioned, effective-dated rules engine, flagged ⚠️ VERIFY
  until Florida healthcare counsel confirms them (R-15.6).
- Only synthetic data outside production (R-7.1.3, R-15.1).
- TODO: budget, timeline, team, and who operates production.

## Success measures
- TODO: pick targets, e.g. % of denials worked before the appeal deadline, recovered $ per
  practice per month, late-payment interest collected, clean-claim rate, days in A/R.
