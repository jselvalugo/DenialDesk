"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "./Button";

/** Disables itself and shows `pendingLabel` while its form's server action runs. */
export function SubmitButton({ children, pendingLabel, ...props }: ButtonProps & { pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-disabled={pending} {...props}>
      {pending ? pendingLabel : children}
    </Button>
  );
}
