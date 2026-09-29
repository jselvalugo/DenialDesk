# Spec: <feature name>

Status: draft | approved | in progress | done
Roadmap item: <link>
Requirement IDs: R-x.x, R-y.y

## Goal
One or two sentences: what the user can do after this ships.

## User stories
- As a <role>, I can <action> so that <outcome>.

## Acceptance criteria
- [ ] Concrete, testable statement
- [ ] For each legal deadline: day before, day of, day after
- [ ] ...

## Data / API changes
Tables, fields, endpoints touched. Data classification (REQUIREMENTS §9.1) and audit events.

PHI footprint (HC-3.6): each PHI field stored, why (requirement ID), where it is sent, and when it is
deleted or de-identified. Reference the patient/encounter/claim by ID; never copy identity (HC-3.5).

## Legal rules used
Rule IDs from `rules/` with citations; ⚠️ VERIFY status. "None" if the feature has no legal clock.

## Out of scope
What this spec deliberately does not cover.

## Open questions
Anything a human must answer before building.
