/** Shown on every page outside production (ADR 0003). Server-rendered; cannot be dismissed. */
export function PreviewBanner({ appEnv }: { appEnv: string }) {
  return (
    <div
      role="note"
      aria-label="Environment notice"
      className="flex h-8 items-center justify-center gap-2 border-b border-warning-border bg-warning-bg px-4 text-label text-warning-fg"
    >
      <span className="font-semibold uppercase tracking-wide">{appEnv}</span>
      <span aria-hidden>·</span>
      <span className="font-medium">Synthetic data only. Do not enter real patient information.</span>
    </div>
  );
}
