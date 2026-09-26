import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { isProduction } from "@/lib/env";

export default function OverviewPage() {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
      <PageHeader title="Overview" description="Claim, denial, and deadline activity for this practice." />
      <Panel title="Activity">
        <EmptyState
          title="No claim data yet"
          description="Totals, open denials, and upcoming deadlines appear here once the practice is set up and claims are submitted or remittances are imported."
          action={
            !isProduction() && (
              <Link href="/design" className="text-body font-medium text-brand-600 hover:underline">
                View the design system
              </Link>
            )
          }
        />
      </Panel>
    </div>
  );
}
