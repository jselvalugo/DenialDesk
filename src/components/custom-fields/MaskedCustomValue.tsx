"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n/client";
import type { RevealReason } from "@/domain/custom-fields/values";

const fieldClass =
  "h-8 rounded-control border border-border-strong bg-surface pr-8 pl-2.5 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus";

/** A locked custom field value on a record's detail page: masked until "Open" with a reason (the
 * same pattern as `MaskedMemberId`). Revealed value is held in client state only — never re-fetched
 * or cached, and lost on navigation. */
export function MaskedCustomValue({
  reveal,
}: {
  /** A server action bound to the field and record; it audits the reveal (R-7.5.1). */
  reveal: (reason: RevealReason) => Promise<{ value?: string; error?: string }>;
}) {
  const t = useT("customFields");
  const [value, setValue] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (value !== null) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-body text-text">{value}</span>
        <Button size="sm" variant="ghost" onClick={() => setValue(null)}>
          {t("value.hide")}
        </Button>
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-body text-muted">{t("value.locked")}</span>
      {choosing ? (
        <form
          className="inline-flex items-center gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const reason = String(new FormData(event.currentTarget).get("reason")) as RevealReason;
            const result = await reveal(reason);
            if (result.value !== undefined) {
              setValue(result.value);
              setChoosing(false);
            } else setError(result.error ?? t("value.error"));
          }}
        >
          <label className="sr-only" htmlFor="cf-reveal-reason">
            {t("value.reasonLabel")}
          </label>
          <select id="cf-reveal-reason" name="reason" className={fieldClass} defaultValue="appeal">
            <option value="appeal">{t("value.reasonAppeal")}</option>
            <option value="eligibility">{t("value.reasonEligibility")}</option>
            <option value="payer_call">{t("value.reasonPayerCall")}</option>
            <option value="other">{t("value.reasonOther")}</option>
          </select>
          <Button size="sm" type="submit">
            {t("value.open")}
          </Button>
        </form>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>
          {t("value.open")}
        </Button>
      )}
      {error && <span className="text-label text-danger-fg">{error}</span>}
    </span>
  );
}
