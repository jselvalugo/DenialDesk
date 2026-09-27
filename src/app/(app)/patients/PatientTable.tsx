"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import type { PatientListRow } from "@/domain/patients/queries";
import { ageOn, patientName, sexLabel } from "@/domain/patients/record";
import { useFormat, useT } from "@/i18n/client";

/** Patient rows for the list and search results. `today` (YYYY-MM-DD) comes from the server for ages. */
export function PatientTable({
  rows,
  caption,
  today,
}: {
  rows: PatientListRow[];
  caption: string;
  today: string;
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
          <Th>{t("field.sex")}</Th>
          <Th>{t("field.location")}</Th>
          <Th>{t("field.coverage")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const age = ageOn(row.birthDate, today);
          // A restricted (sensitivity-tagged) record shows only what identifies it in a list; sex
          // and location wait for the chart (minimum necessary, OA-043).
          const restricted = row.sensitivityTags.length > 0;
          const location = restricted ? "" : [row.city, row.state].filter(Boolean).join(", ");
          return (
            <Tr key={row.id}>
              <Td className="font-medium">
                <span className="flex items-center gap-2">
                  <Link href={`/patients/${row.id}`} className="text-link hover:underline">
                    {patientName(row)}
                  </Link>
                  {restricted && <Badge tone="warning">{t("badge.restricted")}</Badge>}
                </span>
              </Td>
              <Td>
                <Code>{row.mrn}</Code>
              </Td>
              <Td className="tabular whitespace-nowrap">
                {f.date(row.birthDate)}
                {age !== null && <span className="ml-2 text-muted">{t("field.age", { years: age })}</span>}
              </Td>
              <Td>{restricted ? <span className="text-subtle">—</span> : sexLabel(row.sex, t)}</Td>
              <Td>
                {location ? (
                  location
                ) : (
                  <span className="text-subtle">{restricted ? "—" : t("detail.notOnFile")}</span>
                )}
              </Td>
              <Td>
                {row.payerName ?? (
                  <Badge tone="neutral" dot={false}>
                    {t("badge.selfPay")}
                  </Badge>
                )}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
