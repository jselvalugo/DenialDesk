## Summary

<!-- What changed and why. Link the spec in docs/specs/. -->

## Requirement IDs

<!-- e.g. R-3.1.3, R-7.5.1 -->

## SOC 2 controls touched

<!-- From compliance-checker, e.g. CC6.1, CC8.1, PI1.2 -->

## Data-classification impact

<!-- None / Internal / Confidential / Restricted PHI / Restricted-Sensitive PHI (REQUIREMENTS §9.1) -->

## New dependencies

<!-- Name, version, license, why. "None" if none. -->

## Test evidence

<!-- Commands run and results. Boundary tests for any legal deadline. -->

## Reviewer-agent results

- reviewer:
- security-reviewer:
- compliance-checker:

## Checklist

- [ ] Synthetic data only; no PHI in code, fixtures, logs, or snapshots
- [ ] No `MUST` rule in `docs/HIPAA_COMPLIANCE.md` or `docs/SECURE_CODING.md` broken (or exception ADR linked)
- [ ] No new dependency, or each one passes `docs/SECURE_CODING.md` Part A and is in the register
- [ ] No legal deadline, rate, or threshold outside `rules/`
- [ ] Spec and roadmap checkboxes updated
- [ ] IAM / branch protection / audit-logging changes called out for human sign-off (or none)
