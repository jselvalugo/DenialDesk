import { Badge, type Tone } from "@/components/ui/Badge";

const statuses: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "info" },
  approved: { label: "Approved", tone: "success" },
  exported: { label: "Exported", tone: "success" },
  superseded: { label: "Superseded", tone: "neutral" },
  void: { label: "Void", tone: "danger" },
};

export function VoucherStatusBadge({ status }: { status: string }) {
  const { label, tone } = statuses[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={tone}>{label}</Badge>;
}
