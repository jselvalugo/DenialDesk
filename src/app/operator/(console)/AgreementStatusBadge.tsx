import { Badge, type Tone } from "@/components/ui/Badge";
import type { AgreementStatus } from "@/domain/platform/agreements";
import type { MessageKey } from "@/i18n/messages/types";
import { getT } from "@/i18n/server";

const labels: Record<AgreementStatus, { labelKey: MessageKey<"operator">; tone: Tone }> = {
  missing: { labelKey: "badge.missing", tone: "danger" },
  not_yet_effective: { labelKey: "badge.notYetEffective", tone: "info" },
  active: { labelKey: "status.active", tone: "success" },
  expiring: { labelKey: "badge.expiringSoon", tone: "warning" },
  expired: { labelKey: "badge.expired", tone: "danger" },
};

/** Business Associate Agreement status for a customer practice (docs/specs/practice-agreements.md). */
export async function AgreementStatusBadge({ status }: { status: AgreementStatus }) {
  const t = await getT("operator");
  const { labelKey, tone } = labels[status];
  return <Badge tone={tone}>{t(labelKey)}</Badge>;
}
