"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import type { ListColumnDefinition } from "@/domain/custom-fields/list-values";
import type { PatientListRow } from "@/domain/patients/queries";
import { patientName } from "@/domain/patients/record";
import { useFormat, useT } from "@/i18n/client";

/** A custom field value's typed cell, formatted plainly (dates and numbers follow the locale, a
 * checkbox reads Yes/blank; text and select show as stored — never translated, CLAUDE.md #5). */
function ListCell({ value }: { value: string | number | boolean | undefined }) {
  const t = useT("customFields");
  const f = useFormat();
  if (value === undefined || value === "") return <span className="text-muted">—</span>;
  if (typeof value === "boolean") return value ? <span>{t("input.checkboxYes")}</span> : <span>—</span>;
  if (typeof value === "number") return <span className="tabular">{f.number(value)}</span>;
  // ISO dates (YYYY-MM-DD) are the only string shape this module formats specially.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return <span className="tabular">{f.date(value)}</span>;
  return <span>{value}</span>;
}

/** Patient rows for the list and search results, plus up to 5 non-sensitive custom field columns
 * marked "Show in list" (docs/specs/settings-and-custom-fields.md, S2 table-column addendum). */
export function PatientTable({
  rows,
  caption,
  listColumns = [],
  listValues = {},
}: {
  rows: PatientListRow[];
  caption: string;
  listColumns?: ListColumnDefinition[];
  listValues?: Record<string, Record<string, string | number | boolean>>;
}) {
  const t = useT("patients");
  const tc = useT("common");
  const f = useFormat();
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>{tc("word.patient")}</Th>
          <Th>{t("field.mrn")}</Th>
          <Th>{t("field.birthDate")}</Th>
          <Th>{t("field.primaryPayer")}</Th>
          {listColumns.map((col) => (
            <Th key={col.fieldId}>{col.label}</Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <Td>
              <Link href={`/patients/${row.id}`} className="font-medium text-link hover:underline">
                {patientName(row)}
              </Link>
              {row.sensitivityTags.length > 0 && (
                <span className="ml-2">
                  <Badge tone="warning">{t("badge.restricted")}</Badge>
                </span>
              )}
            </Td>
            <Td className="font-mono text-label">{row.mrn}</Td>
            <Td className="tabular">{f.date(row.birthDate)}</Td>
            <Td>{row.payerName ?? <span className="text-muted">{t("badge.selfPay")}</span>}</Td>
            {listColumns.map((col) => (
              <Td key={col.fieldId}>
                <ListCell value={listValues[row.id]?.[col.key]} />
              </Td>
            ))}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
