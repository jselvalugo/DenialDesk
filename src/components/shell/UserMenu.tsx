"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { signOut } from "@/auth/actions";

/** Workforce display fields only; this reaches the browser, so never add patient or contact data. */
export interface ShellUser {
  displayName: string;
  tenantName: string;
  role: string;
}

const roleLabels: Record<string, string> = {
  admin: "Administrator",
  manager: "RCM manager",
  specialist: "Denial specialist",
  compliance: "Compliance",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

/** Signed-in user, role, and practice, with sign-out. A disclosure: Escape or an outside click closes it. */
export function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const role = roleLabels[user.role] ?? user.role;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className="relative"
      onBlur={(event) => {
        // Tabbing away, or the app launcher taking focus, closes the menu.
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 items-center gap-2.5 rounded-control px-1.5 text-left hover:bg-surface-muted"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-8 items-center justify-center rounded-full bg-navy text-label font-semibold text-white"
        >
          {initials(user.displayName)}
        </span>
        <span className="leading-tight">
          <span className="block text-body font-medium text-text">{user.displayName}</span>
          <span className="block text-label text-muted">{role}</span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 text-subtle" />
      </button>
      {open && (
        <div
          id={panelId}
          className="absolute top-full right-0 z-40 mt-1 w-72 rounded-panel border border-border bg-surface shadow-sm"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-body font-semibold text-text">{user.displayName}</p>
            <p className="text-label text-muted">{role}</p>
            <p className="mt-2 text-label text-subtle">Practice</p>
            <p className="text-body text-text">{user.tenantName}</p>
          </div>
          <form action={signOut} className="p-1.5">
            <button
              type="submit"
              className="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body font-medium text-text hover:bg-surface-muted"
            >
              <LogOut aria-hidden="true" className="size-4 text-subtle" />
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
