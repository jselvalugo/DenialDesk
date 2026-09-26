import { signOut } from "@/auth/actions";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export interface ShellUser {
  displayName: string;
  tenantName: string;
  role: string;
  demo?: boolean;
}

const roleLabels: Record<string, string> = {
  admin: "Administrator",
  manager: "RCM manager",
  specialist: "Denial specialist",
  compliance: "Compliance",
};

export function TopBar({ user }: { user: ShellUser | null }) {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-label font-medium text-subtle">Practice</span>
        <span className="truncate text-body font-medium text-text">{user?.tenantName ?? "Style guide"}</span>
        {user?.demo && <Badge tone="info">Demo practice · shared with other visitors</Badge>}
      </div>
      {user && (
        <div className="flex items-center gap-4">
          <div className="text-right leading-tight">
            <p className="text-body font-medium text-text">{user.displayName}</p>
            <p className="text-label text-muted">{roleLabels[user.role] ?? user.role}</p>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
