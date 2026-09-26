import type { NavApp } from "./navigation";

/** App tile colors: chart-series tokens, each ≥ 3:1 against the white icon (DESIGN.md §4). */
export const toneClasses: Record<NavApp["tone"], string> = {
  teal: "bg-chart-1",
  navy: "bg-chart-2",
  blue: "bg-chart-3",
  amber: "bg-chart-4",
  slate: "bg-neutral-fg",
};
