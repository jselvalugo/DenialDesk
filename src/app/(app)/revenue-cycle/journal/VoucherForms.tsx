"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { Select } from "@/components/ui/Select";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import { useT } from "@/i18n/client";
import {
  approveVoucherAction,
  exportVoucherAction,
  prepareVoucherAction,
  voidVoucherAction,
  type VoucherActionState,
} from "./actions";

export function PrepareVoucherForm({ files }: { files: Array<{ value: string; label: string }> }) {
  const t = useT("revenue");
  const [state, action] = useActionState<VoucherActionState, FormData>(prepareVoucherAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <FormAlert message={state.error} />
      <div className="flex flex-wrap items-end gap-3">
        <Select label={t("journal.monthlyFile")} name="fileId" options={files} className="min-w-72" />
        <SubmitButton variant="primary" pendingLabel={t("journal.preparing")}>
          {t("journal.prepareVoucher")}
        </SubmitButton>
      </div>
    </form>
  );
}

export function ApproveVoucherForm({ voucherId }: { voucherId: string }) {
  const t = useT("revenue");
  const [state, action] = useActionState<VoucherActionState, FormData>(approveVoucherAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <FormAlert message={state.error} />
      <input type="hidden" name="voucherId" value={voucherId} />
      <SubmitButton variant="primary" pendingLabel={t("journal.approving")}>
        {t("journal.approveVoucher")}
      </SubmitButton>
    </form>
  );
}

export function ExportVoucherButton({ voucherId, label }: { voucherId: string; label: string }) {
  const t = useT("revenue");
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const download = () =>
    startTransition(async () => {
      const result = await exportVoucherAction(voucherId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(undefined);
      const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
      router.refresh();
    });
  return (
    <div className="flex flex-col items-start gap-2">
      <FormAlert message={error} />
      <Button variant="secondary" onClick={download} disabled={pending} aria-disabled={pending}>
        {pending ? t("journal.exporting") : label}
      </Button>
    </div>
  );
}

export function VoidVoucherForm({ voucherId, exported }: { voucherId: string; exported: boolean }) {
  const t = useT("revenue");
  const [state, action] = useActionState<VoucherActionState, FormData>(voidVoucherAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <FormAlert message={state.error} />
      <input type="hidden" name="voucherId" value={voucherId} />
      <TextField
        label={t("journal.reasonForVoiding")}
        name="reason"
        required
        minLength={10}
        maxLength={500}
        hint={t("hint.auditReason")}
        className="w-96 max-w-full"
      />
      {exported && (
        <label className="flex items-start gap-2 text-body text-text">
          <input type="checkbox" name="reversedInGl" required className="mt-1" />
          <span>{t("journal.reversedInGlConfirm")}</span>
        </label>
      )}
      <SubmitButton variant="danger" pendingLabel={t("journal.voiding")}>
        {t("journal.voidVoucher")}
      </SubmitButton>
    </form>
  );
}
