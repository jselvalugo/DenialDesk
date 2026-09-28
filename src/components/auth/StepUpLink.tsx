"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Shown beside a refusal that needs a fresh MFA verification (`stepUpRequired`, R-7.2.2): sends the
 * administrator to `/step-up` and straight back to the page they were on to retry. The path is only
 * a hint; `/step-up` runs it through `stepUpTarget` before redirecting anywhere.
 */
export function StepUpLink({ label }: { label: string }) {
  const pathname = usePathname();
  return (
    <Link
      href={`/step-up?returnTo=${encodeURIComponent(pathname)}`}
      className="font-medium text-link hover:underline"
    >
      {label}
    </Link>
  );
}
