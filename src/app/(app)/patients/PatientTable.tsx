"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import type { PatientListRow } from "@/domain/patients/queries";
import { patientName } from "@/domain/patients/record";
import { useFormat, useT } from "@/i18n/client";

/** Patient rows for the list and search results. */
export function PatientTable({ rows, caption }: { rows: PatientListRow[]; caption: string }) {
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
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
