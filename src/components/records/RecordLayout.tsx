import type { ReactNode } from "react";

/**
 * Two-column body of a record page: related work (tables of claims, denials, history) in the wide
 * main column and the record's own facts in a 320–360px aside. Stacks under 1024px.
 */
export function RecordLayout({ aside, children }: { aside: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,360px)]">
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
      <div className="flex min-w-0 flex-col gap-6">{aside}</div>
    </div>
  );
}
