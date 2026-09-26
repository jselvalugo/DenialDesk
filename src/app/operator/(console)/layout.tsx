import Image from "next/image";
import { requireOperator } from "@/auth/operator";
import { keepOperatorSessionAlive, signOutOperator } from "@/auth/operator-actions";
import { SessionTimeout } from "@/components/shell/SessionTimeout";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

/** Platform operator console: separate chrome so it's never confused with a practice's workspace. */
export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const operator = await requireOperator();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header
        data-chrome="dark"
        className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-navy px-6 text-white"
      >
        <div className="flex items-center gap-4">
          <span className="rounded-control bg-white px-2 py-1">
            <Image src="/brand/denialdesk-logo.png" alt="DenialDesk" width={110} height={26} />
          </span>
          <span className="text-body font-semibold">Platform console</span>
          <Badge tone="warning">Operator</Badge>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-body text-white/85">{operator.displayName}</span>
          <form action={signOutOperator}>
            <Button type="submit" size="sm" variant="secondary">
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto bg-canvas px-6 py-6 focus:outline-none"
      >
        {children}
      </main>
      <SessionTimeout
        keepAlive={keepOperatorSessionAlive}
        signOutAction={signOutOperator}
        timeoutHref="/operator/login?reason=timeout"
      />
    </div>
  );
}
