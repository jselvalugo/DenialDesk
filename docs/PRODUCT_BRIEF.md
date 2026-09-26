# DenialDesk — product brief

> Draft. Fill in the `TODO`s — this document drives every agent's work,
> so vague answers here become wrong code later.

## Problem
Denied claims are worked by hand across payer portals, spreadsheets, and email.
Teams miss appeal deadlines, rework the same denial types repeatedly, and can't
see which denials are worth the effort.

## Users
- **Denial specialist** — works a queue of denials day to day.
- **RCM manager** — watches volume, recovery rate, and staff workload.
- TODO: anyone else (clinicians for medical-necessity letters? billing vendors?)

## Core workflow (MVP)
1. **Ingest** denials — TODO: from 835 ERA files? CSV export? clearinghouse API?
2. **Classify** each denial by CARC/RARC code into actionable categories.
3. **Prioritize** a work queue by dollar value, appeal deadline, and win likelihood.
4. **Work** a denial: see claim details, notes, assign, change status.
5. **Appeal**: generate a draft appeal letter from templates (+ AI assist), export PDF.
6. **Track** outcome (overturned / upheld / written off) and report on it.

## Out of scope for MVP
- Direct submission to payer portals
- EHR integrations
- TODO

## Constraints
- HIPAA: hosting with a BAA, encryption at rest/in transit, audit log of PHI access.
- TODO: single clinic or multi-tenant SaaS?
- TODO: budget / timeline / who operates it

## Success measures
- TODO: e.g. % of denials worked before deadline, recovered $ per month, time per appeal.
