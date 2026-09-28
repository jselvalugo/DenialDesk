import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { canManageIntegrations } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { hasRecentMfa } from "@/auth/step-up";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel } from "@/components/ui/Panel";
import { withTenant } from "@/db/tenant";
import { getConnection } from "@/domain/integrations/connections";
import {
  auditPayerMappingsViewed,
  listMappablePayers,
  listPayerMappings,
  MAX_PAYER_MAPPING_ROWS,
} from "@/domain/integrations/payer-mappings";
import { getFormat, getT } from "@/i18n/server";
import { integrationActor } from "../../form-state";
import { PayerMappingForm } from "./PayerMappingForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("integrations");
  return { title: t("payers.metaTitle") };
}

/**
 * Payer mapping for one connection (docs/specs/patient-integrations.md PI2b): each insurer the EHR/PM
 * reported, mapped to one of the practice's payers or left unmapped. Administrators only (anyone else
 * gets a 404, as on the connection page); saving needs a recent MFA step-up, checked by the server.
 * The page shows payor keys, which are Restricted PHI on the patient rows they come from, so viewing
 * it is audited (IDs and counts only).
 */
export default async function PayerMappingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const auth = await requireAuth();
  if (!canManageIntegrations(auth.role)) notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const actor = integrationActor(auth);
  const loaded = await withTenant(auth, async (tx) => {
    const connection = await getConnection(tx, id.data);
    if (!connection) return null;
    const list = await listPayerMappings(tx, id.data);
    const payers = await listMappablePayers(tx);
    await auditPayerMappingsViewed(tx, actor, id.data, list);
    return { connection, list, payers };
  });
  if (!loaded) notFound();
  const { connection, list, payers } = loaded;

  const t = await getT("integrations");
  const ts = await getT("settings");
  const f = await getFormat();
  // The inline confirmation after a save (a redirect back here with the count): a small whole number only.
  const saved = /^\d{1,4}$/.test((await searchParams).saved ?? "")
    ? Number((await searchParams).saved)
    : null;
  const revoked = connection.status === "revoked";

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        label={ts("nav.breadcrumb")}
        items={[
          { label: ts("tabs.integrations"), href: "/settings/integrations" },
          { label: connection.displayName, href: `/settings/integrations/${connection.id}` },
          { label: t("payers.crumb") },
        ]}
      />
      {saved !== null && (
        <p
          role="status"
          className="rounded-panel border border-success-border bg-success-bg p-3 text-body text-success-fg"
        >
          {saved === 0 ? t("payers.nothingChanged") : t("payers.saved", { count: saved })}
        </p>
      )}
      {revoked && (
        <p
          role="note"
          className="rounded-panel border border-warning-border bg-warning-bg p-3 text-body text-warning-fg"
        >
          {t("payers.revokedNotice")}
        </p>
      )}
      <Panel
        title={t("payers.title")}
        description={t("payers.description")}
        flush={list.rows.length > 0 && payers.length > 0}
      >
        {list.rows.length === 0 ? (
          <EmptyState title={t("payers.emptyTitle")} description={t("payers.emptyDescription")} />
        ) : payers.length === 0 ? (
          <EmptyState title={t("payers.noPayersTitle")} description={t("payers.noPayersDescription")} />
        ) : (
          <>
            <PayerMappingForm
              connectionId={connection.id}
              rows={list.rows}
              payers={payers}
              needsStepUp={!hasRecentMfa(auth.mfaVerifiedAt)}
              readOnly={revoked}
            />
            {list.truncated && (
              <p className="border-t border-border px-4 py-2.5 text-label text-muted">
                {t("payers.truncated", { count: f.number(MAX_PAYER_MAPPING_ROWS) })}
              </p>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
