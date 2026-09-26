import { Badge, type Tone } from "@/components/ui/Badge";
import type { AgreementStatus } from "@/domain/platform/agreements";

const labels: Record<AgreementStatus, { label: string; tone: Tone }> = {
  missing: { label: "No BAA", tone: "danger" },
  not_yet_effective: { label: "Not yet effective", tone: "info" },
  active: { label: "Active", tone: "success" },
  expiring: { label: "Expiring soon", tone: "warning" },
  expired: { label: "Expired", tone: "danger" },
};

/** Business Associate Agreement status for a customer practice (docs/specs/practice-agreements.md). */
export function AgreementStatusBadge({ status }: { status: AgreementStatus }) {
  const { label, tone } = labels[status];
  return <Badge tone={tone}>{label}</Badge>;
}
