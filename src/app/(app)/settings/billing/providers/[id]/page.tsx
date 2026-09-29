import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { hasRecentMfa } from "@/auth/step-up";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { getProviderBilling } from "@/domain/settings/billing";
import { getT } from "@/i18n/server";
import { billingActor } from "../../form-state";
import { ProviderBillingForm } from "../../ProviderBillingForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("billing.providerMetaTitle") };
}

// One provider's billing details (docs/specs/claims.md C3a-S). The page reads the TIN's last four only (audited).
export default async function ProviderBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!canConfigureSettings(auth.role)) notFound();
  const { id } = await params;
  const t = await getT("settings");
  const provider = await withTenant(auth, (tx) => getProviderBilling(tx, billingActor(auth), id));
  if (!provider) notFound();
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[{ label: t("tabs.billing"), href: "/settings/billing" }, { label: provider.name }]}
      />
      <Panel flush>
        <ProviderBillingForm
          provider={{
            id: provider.id,
            firstName: provider.firstName,
            lastName: provider.lastName,
            addressLine1: provider.addressLine1,
            city: provider.city,
            state: provider.state,
            postalCode: provider.postalCode,
            tinType: provider.tinType,
            tinLast4: provider.tinLast4,
          }}
          needsStepUp={!hasRecentMfa(auth.mfaVerifiedAt)}
        />
      </Panel>
    </div>
  );
}
