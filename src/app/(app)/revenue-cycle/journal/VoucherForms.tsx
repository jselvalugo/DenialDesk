"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { FormAlert } from "@/components/ui/FormAlert";
import { Select } from "@/components/ui/Select";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { TextField } from "@/components/ui/TextField";
import {
  approveVoucherAction,
  exportVoucherAction,
  prepareVoucherAction,
  voidVoucherAction,
  type VoucherActionState,
} from "./actions";

export function PrepareVoucherForm({ files }: { files: Array<{ value: string; label: string }> }) {
  const [state, action] = useActionState<VoucherActionState, FormData>(prepareVoucherAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <FormAlert message={state.error} />
      <div className="flex flex-wrap items-end gap-3">
        <Select label="Monthly file" name="fileId" options={files} className="min-w-72" />
        <SubmitButton variant="primary" pendingLabel="Preparing…">
          Prepare voucher
        </SubmitButton>
      </div>
    </form>
  );
}

export function ApproveVoucherForm({ voucherId }: { voucherId: string }) {
  const [state, action] = useActionState<VoucherActionState, FormData>(approveVoucherAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <FormAlert message={state.error} />
      <input type="hidden" name="voucherId" value={voucherId} />
      <SubmitButton variant="primary" pendingLabel="Approving…">
        Approve voucher
      </SubmitButton>
    </form>
  );
}

export function ExportVoucherButton({ voucherId, label }: { voucherId: string; label: string }) {
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
        {pending ? "Exporting…" : label}
      </Button>
    </div>
  );
}

export function VoidVoucherForm({ voucherId, exported }: { voucherId: string; exported: boolean }) {
  const [state, action] = useActionState<VoucherActionState, FormData>(voidVoucherAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <FormAlert message={state.error} />
      <input type="hidden" name="voucherId" value={voucherId} />
      <TextField
        label="Reason for voiding"
        name="reason"
        required
        minLength={10}
        maxLength={500}
        hint="Recorded in the audit trail. No patient information."
        className="w-96 max-w-full"
      />
      {exported && (
        <label className="flex items-start gap-2 text-body text-text">
          <input type="checkbox" name="reversedInGl" required className="mt-1" />
          <span>This voucher was exported, and I reversed its entry in the general ledger.</span>
        </label>
      )}
      <SubmitButton variant="danger" pendingLabel="Voiding…">
        Void voucher
      </SubmitButton>
    </form>
  );
}
