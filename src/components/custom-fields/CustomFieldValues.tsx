"use client";

import { useFormat, useT } from "@/i18n/client";
import type { LoadedCustomFieldValue, RevealReason } from "@/domain/custom-fields/values";
import { MaskedCustomValue } from "./MaskedCustomValue";

/** A single value's plain display (dates and numbers follow the locale; text/select/checkbox are
 * shown as stored — never translated, CLAUDE.md #5). */
function DisplayValue({ loaded }: { loaded: LoadedCustomFieldValue }) {
  const t = useT("customFields");
  const f = useFormat();
  if (loaded.unavailable) return <span className="text-muted">{t("value.unavailable")}</span>;
  const { value, type } = loaded;
  if (value === undefined) return <span className="text-muted">{t("value.notOnFile")}</span>;
  if (type === "checkbox") return <span>{value ? t("input.checkboxYes") : "—"}</span>;
  if (type === "date" && typeof value === "string") return <span className="tabular">{f.date(value)}</span>;
  if (type === "number" && typeof value === "number")
    return <span className="tabular">{f.number(value)}</span>;
  return <span>{String(value)}</span>;
}

/**
 * Read-only custom field list for a record's detail page (docs/specs/settings-and-custom-fields.md
 * S2). Masked entries show "Locked" with an "Open" + reason dialog; the revealed value lives only
 * in the browser for that view.
 */
export function CustomFieldValues({
  values,
  reveal,
}: {
  values: LoadedCustomFieldValue[];
  /** A server action bound to the record; called with the field ID and a reason. */
  reveal: (fieldId: string, reason: RevealReason) => Promise<{ value?: string; error?: string }>;
}) {
  if (values.length === 0) return null;
  return (
    <dl className="flex flex-col gap-3">
      {values.map((loaded) => (
        <div key={loaded.fieldId} className="flex flex-col gap-0.5">
          <dt className="text-label font-medium text-muted">{loaded.label}</dt>
          <dd className="text-body text-text">
            {loaded.masked ? (
              <MaskedCustomValue reveal={(reason) => reveal(loaded.fieldId, reason)} />
            ) : (
              <DisplayValue loaded={loaded} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
