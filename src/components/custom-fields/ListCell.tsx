"use client";

import type { CustomFieldType } from "@/domain/settings/custom-fields";
import { useFormat, useT } from "@/i18n/client";

/**
 * A custom field value's typed cell in a record list, formatted plainly (dates and numbers follow
 * the locale, a checkbox reads Yes/blank; text and select show as stored — never translated,
 * CLAUDE.md #5). Shared by every record table's list columns
 * (docs/specs/settings-and-custom-fields.md S2 table-column addendum).
 */
export function ListCell({
  type,
  value,
}: {
  type: CustomFieldType;
  value: string | number | boolean | undefined;
}) {
  const t = useT("customFields");
  const f = useFormat();
  if (value === undefined || value === "") return <span className="text-muted">—</span>;
  // Formatted by the field's type, as the chart does, so a text value that looks like a date is
  // shown as typed.
  if (type === "checkbox") return value === true ? <span>{t("input.checkboxYes")}</span> : <span>—</span>;
  if (type === "number" && typeof value === "number")
    return <span className="tabular">{f.number(value)}</span>;
  if (type === "date" && typeof value === "string") return <span className="tabular">{f.date(value)}</span>;
  return <span>{String(value)}</span>;
}
