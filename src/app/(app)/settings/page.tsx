import type { Metadata } from "next";
import { canConfigureSettings } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { getT } from "@/i18n/server";
import type { MessageKey } from "@/i18n/messages/types";
import { isProduction, syntheticDataOnly } from "@/lib/env";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("settings");
  return { title: t("page.title") };
}

const roleKeys: Record<string, MessageKey<"common">> = {
  admin: "role.admin",
  manager: "role.manager",
  specialist: "role.specialist",
  compliance: "role.compliance",
};

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-4 border-b border-border py-3 last:border-b-0">
      <dt className="text-label font-medium text-muted">{term}</dt>
      <dd className="text-body text-text">{children}</dd>
    </div>
  );
}

export default async function GeneralSettingsPage() {
  const auth = await requireAuth();
  const t = await getT("settings");
  const tc = await getT("common");
  const roleKey = roleKeys[auth.role];
  const role = roleKey ? tc(roleKey) : auth.role;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title={t("general.profileTitle")} description={t("general.profileDescription")}>
        <dl>
          <Row term={t("general.practiceName")}>{auth.tenantName}</Row>
          <Row term={t("general.environment")}>
            {isProduction() ? (
              t("general.production")
            ) : (
              <Badge tone="warning">
                {t("general.preProduction")}
                {syntheticDataOnly() ? ` · ${t("general.syntheticDataOnly")}` : ""}
              </Badge>
            )}
          </Row>
          <Row term={t("general.dataResidency")}>{t("general.dataResidencyValue")}</Row>
        </dl>
        <p className="mt-3 text-label text-muted">{t("general.contactSupport")}</p>
      </Panel>
      <Panel title={t("general.accountTitle")} description={t("general.accountDescription")}>
        <dl>
          <Row term={tc("word.name")}>{auth.displayName}</Row>
          <Row term={tc("word.email")}>{auth.email}</Row>
          <Row term={tc("word.role")}>{role}</Row>
          <Row term={t("general.canChangeSettings")}>
            {canConfigureSettings(auth.role) ? tc("word.yes") : t("general.viewOnly")}
          </Row>
        </dl>
      </Panel>
    </div>
  );
}
