import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isProduction } from "@/lib/env";
import { SetupForm } from "./SetupForm";

export const metadata: Metadata = { title: "Set up the operator account" };

/** Pre-production only: create or recover the operator account with the setup code. */
export default function OperatorSetupPage() {
  if (isProduction()) notFound();
  return (
    <>
      <h1 className="font-serif text-[1.375rem] leading-8 font-bold text-primary">
        Set up the operator account
      </h1>
      <p className="mt-1 mb-6 text-body text-muted">
        Use the operator email configured for this environment and its setup code. This sets a new password
        and restarts two-step setup, and signs the account out everywhere.
      </p>
      <SetupForm />
    </>
  );
}
