import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { secondaryLinkButtonClass } from "@/components/ui/linkButton";
import { withTenant } from "@/db/tenant";
import { listBillingTargets, type MissingField } from "@/domain/settings/billing";
import type { MessageKey } from "@/i18n/messages/types";
import { getT } from "@/i18n/server";
import { billingActor } from "./form-state";

// Settings > Billing (docs/specs/claims.md C3a-S): the providers and locations the 837P reads, and what is
// still missing on each. Administrators only. Checks (in memory) that each stored TIN is readable; shows none.
const MISSING_LABEL = {
  firstName: "billing.form.firstName",
  lastName: "billing.form.lastName",
  addressLine1: "billing.form.addressLine1",
  city: "billing.form.city",
  state: "billing.form.state",
  postalCode: "billing.form.postalCode",
  tin: "billing.form.tin",
} as const satisfies Record<MissingField, MessageKey<"settings">>;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("billing.metaTitle") };
}

export default async function BillingSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAuth();
  if (!canConfigureSettings(auth.role)) notFound();
  const t = await getT("settings");
  const tc = await getT("common");
  const saved = (await searchParams).saved;
  const { providers, locations } = await withTenant(auth, (tx) => listBillingTargets(tx, billingActor(auth)));

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <p className="text-body text-muted">{t("billing.intro")}</p>
      {(saved === "provider" || saved === "location") && (
        <div
          role="status"
          className="rounded-control border border-success-border bg-success-bg px-3 py-2 text-body text-success-fg"
        >
          {t(saved === "provider" ? "billing.saved.provider" : "billing.saved.location")}
        </div>
      )}
      <Panel title={t("billing.providers.title")} description={t("billing.providers.description")} flush>
        {providers.length === 0 ? (
          <EmptyState
            title={t("billing.providers.emptyTitle")}
            description={t("billing.providers.emptyDescription")}
          />
        ) : (
          <Table caption={t("billing.providers.caption")}>
            <thead>
              <tr>
                <Th>{tc("word.name")}</Th>
                <Th>{t("billing.col.npi")}</Th>
                <Th>{t("billing.col.status")}</Th>
                <Th>
                  <span className="sr-only">{t("billing.action.edit")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <Tr key={provider.id}>
                  <Td className="font-medium">{provider.name}</Td>
                  <Td>
                    <Code>{provider.npi}</Code>
                  </Td>
                  <Td>
                    {provider.missing.length === 0 ? (
                      <Badge tone="success">{t("billing.status.complete")}</Badge>
                    ) : (
                      <Badge tone="warning">
                        {t("billing.status.missing", {
                          fields: provider.missing.map((field) => t(MISSING_LABEL[field])).join(", "),
                        })}
                      </Badge>
                    )}
                  </Td>
                  <Td>
                    <Link
                      href={`/settings/billing/providers/${provider.id}`}
                      className={secondaryLinkButtonClass}
                    >
                      {t("billing.action.edit")}
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
      <Panel title={t("billing.locations.title")} description={t("billing.locations.description")} flush>
        {locations.length === 0 ? (
          <EmptyState
            title={t("billing.locations.emptyTitle")}
            description={t("billing.locations.emptyDescription")}
          />
        ) : (
          <Table caption={t("billing.locations.caption")}>
            <thead>
              <tr>
                <Th>{tc("word.name")}</Th>
                <Th>{t("billing.col.city")}</Th>
                <Th>{t("billing.col.pos")}</Th>
                <Th>
                  <span className="sr-only">{t("billing.action.edit")}</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => (
                <Tr key={location.id}>
                  <Td className="font-medium">{location.name}</Td>
                  <Td>{location.city}</Td>
                  <Td>
                    {location.placeOfService ? (
                      <Code>{location.placeOfService}</Code>
                    ) : (
                      <Badge tone="warning">{t("billing.pos.notSet")}</Badge>
                    )}
                  </Td>
                  <Td>
                    <Link
                      href={`/settings/billing/locations/${location.id}`}
                      className={secondaryLinkButtonClass}
                    >
                      {t("billing.action.edit")}
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </div>
  );
}
