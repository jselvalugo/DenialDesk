import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import type { PatientListRow } from "@/domain/patients/queries";
import { patientName } from "@/domain/patients/record";
import { formatDate } from "@/lib/format";

/** Patient rows for the list and search results. */
export function PatientTable({ rows, caption }: { rows: PatientListRow[]; caption: string }) {
  return (
    <Table caption={caption}>
      <thead>
        <tr>
          <Th>Patient</Th>
          <Th>MRN</Th>
          <Th>Date of birth</Th>
          <Th>Primary payer</Th>
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
                  <Badge tone="warning">Sensitive</Badge>
                </span>
              )}
            </Td>
            <Td className="font-mono text-label">{row.mrn}</Td>
            <Td className="tabular">{formatDate(row.birthDate)}</Td>
            <Td>{row.payerName ?? <span className="text-muted">Self-pay</span>}</Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
