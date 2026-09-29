import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { getLocationBilling } from "@/domain/settings/billing";
import { getT } from "@/i18n/server";
import { billingActor } from "../../form-state";
import { LocationPosForm } from "../../LocationPosForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("billing.locationMetaTitle") };
}

// One location's place of service (docs/specs/claims.md C3a-S).
export default async function LocationBillingPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (!canConfigureSettings(auth.role)) notFound();
  const { id } = await params;
  const t = await getT("settings");
  const location = await withTenant(auth, (tx) => getLocationBilling(tx, billingActor(auth), id));
  if (!location) notFound();
  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[{ label: t("tabs.billing"), href: "/settings/billing" }, { label: location.name }]}
      />
      <Panel flush>
        <LocationPosForm id={location.id} placeOfService={location.placeOfService} />
      </Panel>
    </div>
  );
}
