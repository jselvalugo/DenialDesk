"use client";

import { useActionState } from "react";
import { signInDemo, type FormState } from "@/auth/actions";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";

export function DemoSignIn() {
  const [state, action] = useActionState<FormState, FormData>(() => signInDemo(), {});
  return (
    <div className="mt-6">
      <div className="flex items-center gap-3 text-label text-subtle" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <form action={action} className="mt-5 flex flex-col gap-3">
        <FormAlert message={state.error} />
        <SubmitButton pendingLabel="Preparing the demo practice…" className="h-9 w-full">
          Explore the demo practice
        </SubmitButton>
        <p className="text-center text-label text-muted">
          A sample practice with synthetic claims and denials. No account needed.
        </p>
      </form>
    </div>
  );
}
