# ADR 0002: Host on Microsoft Azure, U.S. regions only

Status: proposed — human confirms the regions below

## Context
We handle PHI for Florida practices. We need a HIPAA-eligible cloud under a BAA (R-7.1.1),
U.S.-only storage and processing (Fla. Stat. § 408.051(3), R-3.3.1), a secondary U.S. region
for disaster recovery (R-7.1.2, R-7.9), and org-level policy that blocks other regions (R-3.3.2).

The team chose Microsoft Azure. Azure has no region located in Florida. § 408.051(3) requires
data to be kept in the continental U.S., its territories, or Canada, so any U.S. region
complies; we default to U.S.-only.

## Decision
- **Cloud:** Microsoft Azure, under the Microsoft HIPAA BAA (included in the Product Terms /
  DPA). Only services Microsoft lists as in scope for HIPAA may hold PHI. ⚠️ VERIFY each
  service against Microsoft's current HIPAA/HITRUST scope list before first use.
- **Regions (proposed):** primary **East US 2** (Virginia), DR **Central US** (Iowa). These are
  an Azure region pair, so geo-redundant storage replicates within the U.S. Alternative:
  South Central US (Texas) + North Central US if we want primary closer to Florida.
- **Guardrail:** Azure Policy "Allowed locations" assigned at the management-group root,
  denying any region outside the approved list. Applies to backups, logs, and analytics too.
- **Environments:** separate subscriptions for prod, staging, and dev under one management
  group; no PHI outside prod (R-7.1.3).
- **Identity:** Microsoft Entra ID for workforce SSO; customer SSO via SAML/OIDC (R-7.2.1).
- **Keys and secrets:** Azure Key Vault (Managed HSM if customer-managed keys require it) (R-7.3.4, R-7.3.5).
- **Infrastructure as code:** Terraform with policy-as-code checks in CI (R-7.1.4). TBD in ADR 0001 follow-up if Bicep is preferred.
- Service choices for compute, database, and queues are decided with the tech stack (ADR 0001).

## Consequences
- The rules engine must still compute all legal clocks in America/New_York (§11), independent of region.
- Any AI/LLM service used on PHI must run in a U.S. region under a BAA (R-3.3.7, R-15.2).
  Candidates: Anthropic API under an Anthropic BAA, or Claude via Microsoft Foundry.
  ⚠️ VERIFY BAA coverage and processing location for whichever we choose.
- Vendors (clearinghouse, email, logging, backup) must also be U.S.-only under BAAs (R-5.5.2).
- Customer-facing data residency attestation (R-3.3.5) will cite the approved regions.
