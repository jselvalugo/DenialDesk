import { Badge, type Tone } from "@/components/ui/Badge";
import type { MessageKey } from "@/i18n/messages/types";
import { getT } from "@/i18n/server";

const statuses: Record<string, { labelKey: MessageKey<"revenue">; tone: Tone }> = {
  draft: { labelKey: "voucher.status.draft", tone: "info" },
  approved: { labelKey: "voucher.status.approved", tone: "success" },
  exported: { labelKey: "voucher.status.exported", tone: "success" },
  superseded: { labelKey: "voucher.status.superseded", tone: "neutral" },
  void: { labelKey: "voucher.status.void", tone: "danger" },
};

export async function VoucherStatusBadge({ status }: { status: string }) {
  const t = await getT("revenue");
  const entry = statuses[status];
  return <Badge tone={entry?.tone ?? "neutral"}>{entry ? t(entry.labelKey) : status}</Badge>;
}
