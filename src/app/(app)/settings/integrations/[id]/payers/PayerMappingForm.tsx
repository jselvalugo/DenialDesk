"use client";

import { useActionState } from "react";
import { StepUpLink } from "@/components/auth/StepUpLink";
import { Badge } from "@/components/ui/Badge";
import { Code } from "@/components/ui/Code";
import { Table, Td, Th, Tr } from "@/components/ui/DataTable";
import { FormAlert } from "@/components/ui/FormAlert";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useFormat, useT } from "@/i18n/client";
import type { ConnectionFormState } from "../../form-state";
import { savePayerMappingsAction } from "./actions";

export interface PayerMappingFormRow {
  payorKey: string;
  payorName: string | null;
  payerId: string | null;
  version: string;
  patientCount: number;
  /** False for a stored key a save would refuse: shown read-only, with a note, never submitted. */
  savable: boolean;
  /** The key as shown (invisible characters marked, long keys cut). */
  displayKey: string;
}

/**
 * The payer mapping table (docs/specs/patient-integrations.md PI2b): one row per insurer the
 * connection reported, a select of the practice's payers ("Not mapped" first), and one Save. The
 * step-up link shows when the session's last MFA is too old, and again if the server refuses for that
 * reason (the five-minute window can close between page load and click). Nothing here is access
 * control: the server checks the role, the step-up, and every line again.
 */
export function PayerMappingForm({
  connectionId,
  rows,
  payers,
  needsStepUp,
  readOnly,
}: {
  connectionId: string;
  rows: PayerMappingFormRow[];
  payers: Array<{ id: string; name: string }>;
  needsStepUp: boolean;
  /** A revoked connection: the table is shown, nothing can be changed (the server refuses too). */
  readOnly: boolean;
}) {
  const t = useT("integrations");
  const f = useFormat();
  const [state, action] = useActionState<ConnectionFormState, FormData>(savePayerMappingsAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={connectionId} />
      <div className="flex flex-col gap-3 px-4 pt-4">
        <FormAlert message={state.error} id="payer-mapping-error" />
        {!readOnly && (needsStepUp || state.stepUpRequired) && (
          <div className="flex flex-col items-start gap-1">
            <p className="text-body text-text">{t("payers.stepUpNotice")}</p>
            <StepUpLink label={t("stepUp.link")} />
          </div>
        )}
      </div>
      <Table caption={t("payers.tableCaption")}>
        <thead>
          <tr>
            <Th>{t("payers.col.insurer")}</Th>
            <Th>{t("payers.col.name")}</Th>
            <Th numeric>{t("payers.col.patients")}</Th>
            <Th>{t("payers.col.status")}</Th>
            <Th>{t("payers.col.payer")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Tr key={row.payorKey}>
              <Td className="font-medium">
                <Code>{row.displayKey}</Code>
                {row.savable && (
                  <>
                    <input type="hidden" name="key" value={row.payorKey} />
                    <input type="hidden" name="version" value={row.version} />
                  </>
                )}
              </Td>
              <Td>{row.payorName ?? "—"}</Td>
              <Td numeric>{f.number(row.patientCount)}</Td>
              <Td>
                <Badge tone={row.payerId ? "success" : "neutral"}>
                  {row.payerId ? t("payers.status.mapped") : t("payers.status.unmapped")}
                </Badge>
              </Td>
              <Td>
                {!row.savable ? (
                  <span className="text-label text-muted">{t("payers.keyUnsupported")}</span>
                ) : (
                  <select
                    name="payer"
                    defaultValue={row.payerId ?? ""}
                    disabled={readOnly}
                    aria-label={t("payers.selectLabel", { insurer: row.displayKey })}
                    className="h-8 max-w-xs rounded-control border border-border-strong bg-surface pr-8 pl-2 text-body text-text focus:border-focus focus:outline-2 focus:outline-offset-0 focus:outline-focus"
                  >
                    <option value="">{t("payers.notMapped")}</option>
                    {payers.map((payer) => (
                      <option key={payer.id} value={payer.id}>
                        {payer.name}
                      </option>
                    ))}
                  </select>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {!readOnly && (
        <div className="flex items-center gap-3 px-4 pb-4">
          <SubmitButton variant="primary" pendingLabel={t("payers.saving")}>
            {t("payers.save")}
          </SubmitButton>
        </div>
      )}
    </form>
  );
}
