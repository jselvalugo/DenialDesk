"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Shown when a server action refuses with `stepUpRequired` (R-7.2.2): sends the admin to
 * re-verify MFA and come straight back to the page they were on, so they can retry the action.
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
