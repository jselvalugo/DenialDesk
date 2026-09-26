# ADR 0003: Netlify for pre-production; Azure for production

Status: accepted (2026-09-26)

## Context
We build the product in this repository and deploy previews while it's being built. Production
(any real customer or real PHI) runs on Azure (ADR 0002), deployed by the team separately once
the product is ready. Until then we want fast, cheap preview deploys: Netlify.

Netlify is not our HIPAA host. We do not rely on a Netlify BAA, and its CDN and functions are
not restricted to U.S. regions the way our Azure landing zone will be. ⚠️ VERIFY whether Netlify
offers a BAA; the answer doesn't change this decision.

## Decision
- **Netlify hosts pre-production only**: deploy previews per PR and one shared demo site.
- **Synthetic data only on Netlify, no exceptions** (R-7.1.3, R-15.1). No real patients, claims,
  X12 files, payer credentials, or customer users. This is the same rule as every non-prod
  environment, and the reason Netlify is acceptable at all.
- **Guards in the app** when `APP_ENV` is not `production`:
  - A persistent "Synthetic data — not for real patient information" banner.
  - Uploads (CSV, X12, PDF) accept only files carrying the synthetic-fixture marker produced by
    our generator; everything else is rejected.
  - No live clearinghouse connection; the clearinghouse interface uses a stub (R-7.9.5 adapter).
  - Access to the demo site is restricted (Netlify password protection or an allow-listed login).
- **Stay portable.** Netlify-specific code (config, function wrappers, scheduled-function
  bindings) lives in one adapter folder. Domain logic, rules engine, EDI, and DB access know
  nothing about Netlify. The app also builds as a container so the Azure cutover is a deploy,
  not a rewrite.
- **Database for pre-prod:** Netlify Database (Postgres; confirm its region is U.S.), synthetic data only. It
  is provisioned by the platform and gives each deploy preview an isolated branch. Migrations
  are the same SQL production runs, mirrored into `netlify/database/migrations/` (2026-09-26).
- **Secrets:** Netlify environment variables for pre-prod-only secrets. Production secrets never
  touch Netlify (R-7.3.5).

## Consequences
- Security controls that depend on Azure (Azure Policy, Key Vault, Entra ID, private networking,
  WORM audit storage) are designed behind interfaces now and implemented at the Azure cutover.
  They must be in place before the first real customer.
- Background jobs must fit both Netlify (background/scheduled functions) and Azure (a worker
  container). Keep jobs as plain functions invoked by a thin runner per platform.
- The SOC 2 Type I audit and any customer BAA cover the Azure production system, not Netlify.
- Roadmap: a "Production cutover to Azure" gate sits between building the MVP and onboarding
  the first practice.
