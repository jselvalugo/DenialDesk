import type { NavApp } from "./navigation";

/**
 * Module tile colors (DESIGN.md §4): a colored glyph on its own light tint with a 1px border, so a
 * tile reads like one of our badges rather than a solid colored square. Each glyph is ≥ 5:1 on its tint.
 */
export const toneClasses: Record<NavApp["tone"], string> = {
  teal: "border-tile-teal-border bg-tile-teal-bg text-tile-teal-fg",
  navy: "border-tile-navy-border bg-tile-navy-bg text-tile-navy-fg",
  blue: "border-tile-blue-border bg-tile-blue-bg text-tile-blue-fg",
  amber: "border-tile-amber-border bg-tile-amber-bg text-tile-amber-fg",
  slate: "border-tile-slate-border bg-tile-slate-bg text-tile-slate-fg",
};
