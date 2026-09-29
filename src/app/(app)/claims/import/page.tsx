import type { Metadata } from "next";
import Link from "next/link";
import { canImportCharges } from "@/auth/permissions";
import { requireAuth } from "@/auth/session";
import { Badge } from "@/components/ui/Badge";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { locations, providers } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import {
  CHARGE_COLUMNS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  MAX_REPORT_PROBLEMS,
  SHOWN_PROBLEMS,
  type ChargeColumnKey,
} from "@/domain/claims/charge-file";
import { FILING_WARNING_DAYS } from "@/domain/claims/status";
import type { MessageKey } from "@/i18n/messages/types";
import { getT } from "@/i18n/server";
import { syntheticDataOnly } from "@/lib/env";
import { ImportForm } from "./ImportForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT("claims");
  return { title: t("import.title") };
}

const COLUMN_TEXT_KEYS: Record<ChargeColumnKey, MessageKey<"claims">> = {
  claimNumber: "import.column.claimNumber",
  mrn: "import.column.mrn",
  payer: "import.column.payer",
  serviceDate: "import.column.serviceDate",
  diagnosisCodes: "import.column.diagnosisCodes",
  procedureCode: "import.column.procedureCode",
  modifiers: "import.column.modifiers",
  units: "import.column.units",
  charge: "import.column.charge",
  providerNpi: "import.column.providerNpi",
  location: "import.column.location",
};

export default async function ImportChargesPage() {
  const auth = await requireAuth();
  const t = await getT("claims");
  const allowed = canImportCharges(auth.role);
  // Providers and locations are practice reference data, not patient data: no audit event.
  const { providerRows, locationRows } = allowed
    ? await withTenant(auth, async (tx) => ({
        providerRows: await tx
          .select({ id: providers.id, name: providers.name, npi: providers.npi })
          .from(providers)
          .orderBy(providers.name),
        locationRows: await tx
          .select({ id: locations.id, name: locations.name, city: locations.city })
          .from(locations)
          .orderBy(locations.name),
      }))
    : { providerRows: [], locationRows: [] };

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-6">
      <Breadcrumbs
        label={t("nav.breadcrumb")}
        items={[{ label: t("import.breadcrumbClaims"), href: "/claims" }, { label: t("import.title") }]}
      />
      <PageHeader title={t("import.title")} description={t("import.description")} />
      {allowed ? (
        <>
          <Panel flush>
            <ImportForm
              providers={providerRows.map((p) => ({ id: p.id, label: `${p.name} · NPI ${p.npi}` }))}
              locations={locationRows.map((l) => ({ id: l.id, label: `${l.name} · ${l.city}` }))}
              syntheticOnly={syntheticDataOnly()}
              limits={{
                megabytes: MAX_IMPORT_BYTES / (1024 * 1024),
                rows: MAX_IMPORT_ROWS,
                shownProblems: SHOWN_PROBLEMS,
                reportProblems: MAX_REPORT_PROBLEMS,
                warningDays: FILING_WARNING_DAYS,
              }}
            />
          </Panel>
          <Panel
            title={t("import.format.title")}
            description={t("import.format.description")}
            flush
            actions={
              <a
                href="/api/claims/charge-template"
                download
                className="text-label font-medium text-link hover:underline"
              >
                {t("import.format.template")}
              </a>
            }
          >
            <Table caption={t("import.format.tableCaption")}>
              <thead>
                <tr>
                  <Th>{t("import.format.column")}</Th>
                  <Th>{t("import.format.rule")}</Th>
                </tr>
              </thead>
              <tbody>
                {CHARGE_COLUMNS.map((column) => (
                  <Tr key={column.key}>
                    <Td className="align-top whitespace-nowrap">
                      {/* The header names are an English file-format contract, quoted as-is. */}
                      <span className="font-mono text-label font-medium">{column.label}</span>{" "}
                      <Badge tone={column.required ? "info" : "neutral"}>
                        {column.required ? t("import.format.required") : t("import.format.optional")}
                      </Badge>
                    </Td>
                    <Td>{t(COLUMN_TEXT_KEYS[column.key])}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Panel>
        </>
      ) : (
        <p role="note" className="text-body text-muted">
          {t("import.forbidden")}{" "}
          <Link href="/claims" className="font-medium text-link hover:underline">
            {t("import.backToClaims")}
          </Link>
        </p>
      )}
    </div>
  );
}
