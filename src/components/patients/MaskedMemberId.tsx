"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";

const fieldClass =
  "h-8 rounded-control border border-border-strong bg-surface pr-8 pl-2.5 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus";

/** Member ID masked to its last 4; revealing it asks why and is audited (R-7.3.3, R-7.5.1). */
export function MaskedMemberId({
  last4,
  reveal,
}: {
  last4: string;
  /** A server action bound to the record (denial or patient); it audits the reveal. */
  reveal: (reason: string) => Promise<{ value?: string; error?: string }>;
}) {
  const [value, setValue] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (value) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-body text-text">{value}</span>
        <Button size="sm" variant="ghost" onClick={() => setValue(null)}>
          Hide
        </Button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-mono text-body text-text" aria-label={`Member ID ending in ${last4}`}>
        •••• {last4}
      </span>
      {choosing ? (
        <form
          className="inline-flex items-center gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const reason = String(new FormData(event.currentTarget).get("reason"));
            const result = await reveal(reason);
            if (result.value) {
              setValue(result.value);
              setChoosing(false);
            } else setError(result.error ?? "Couldn't reveal.");
          }}
        >
          <label className="sr-only" htmlFor="reveal-reason">
            Reason for viewing
          </label>
          <select id="reveal-reason" name="reason" className={fieldClass} defaultValue="appeal">
            <option value="appeal">Preparing appeal</option>
            <option value="eligibility">Checking eligibility</option>
            <option value="payer_call">Payer phone call</option>
            <option value="other">Other</option>
          </select>
          <Button size="sm" type="submit">
            Reveal
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>
          Reveal
        </Button>
      )}
      {error && <span className="text-label text-danger-fg">{error}</span>}
    </span>
  );
}
