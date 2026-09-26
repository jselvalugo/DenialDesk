import { cn } from "@/lib/cn";

/**
 * Horizontal bars for a few non-negative values. Each row shows its label and formatted value as
 * text, so the bars are decorative (DESIGN.md: charts always have a text equivalent).
 */
export function BarList({
  label,
  rows,
  tone = "chart-1",
}: {
  label: string;
  rows: Array<{
    key: string;
    label: string;
    value: number;
    display: string;
    tone?: "chart-1" | "chart-4" | "chart-danger";
  }>;
  tone?: "chart-1" | "chart-4" | "chart-danger";
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const fill = { "chart-1": "bg-chart-1", "chart-4": "bg-chart-4", "chart-danger": "bg-chart-danger" };
  return (
    <ul aria-label={label} className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[7rem_1fr_7rem] items-center gap-3 text-body">
          <span className="text-muted">{row.label}</span>
          <span aria-hidden className="h-3 rounded-sm bg-surface-muted">
            <span
              className={cn("block h-3 rounded-sm", fill[row.tone ?? tone])}
              style={{ width: `${Math.max(0, (row.value / max) * 100)}%` }}
            />
          </span>
          <span className="text-right font-mono tabular">{row.display}</span>
        </li>
      ))}
    </ul>
  );
}
