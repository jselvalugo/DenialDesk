export function TopBar() {
  return (
    <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
      <div className="flex items-center gap-3">
        <span className="text-label font-medium text-subtle">Practice</span>
        <span className="text-body font-medium text-text">Demo practice (synthetic)</span>
      </div>
      {/* Practice switcher and user menu arrive with the tenancy and auth specs. */}
    </div>
  );
}
