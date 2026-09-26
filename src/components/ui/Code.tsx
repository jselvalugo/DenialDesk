import type { ReactNode } from "react";

/** Monospace chip for codes and identifiers: CARC/RARC, CPT/ICD, claim IDs, NPI. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-control border border-border bg-surface-muted px-1 py-px font-mono text-label text-text">
      {children}
    </code>
  );
}
