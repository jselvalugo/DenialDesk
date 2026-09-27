"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, GraduationCap, LogOut } from "lucide-react";
import { signOut } from "@/auth/actions";
import { setLocale } from "@/i18n/actions";
import { useLocale, useT } from "@/i18n/client";
import { LOCALE_NAMES, LOCALES } from "@/i18n/config";
import type { MessageKey } from "@/i18n/messages/types";
import { cn } from "@/lib/cn";

/** Workforce display fields only; this reaches the browser, so never add patient or contact data. */
export interface ShellUser {
  displayName: string;
  tenantName: string;
  role: string;
}

const roleKeys: Record<string, MessageKey<"common">> = {
  admin: "role.admin",
  manager: "role.manager",
  specialist: "role.specialist",
  compliance: "role.compliance",
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}

/**
 * Signed-in user, role, and practice, a link to DenialDesk University, the language choice, and
 * sign-out. A disclosure: Escape or an outside click closes it. The language row (spec:
 * internationalization) lists each language in itself, so someone who can't read the current one
 * still finds theirs.
 */
export function UserMenu({ user }: { user: ShellUser }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const t = useT("shell");
  const tc = useT("common");
  const locale = useLocale();
  const roleKey = roleKeys[user.role];
  const role = roleKey ? tc(roleKey) : user.role;

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
        // Tabbing away, or the module switcher taking focus, closes the menu.
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
            <p className="mt-2 text-label text-subtle">{t("userMenu.practice")}</p>
            <p className="text-body text-text">{user.tenantName}</p>
          </div>
          <div className="border-b border-border p-1.5">
            <Link
              href="/university"
              onClick={() => setOpen(false)}
              className="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body font-medium text-text hover:bg-surface-muted"
            >
              <GraduationCap aria-hidden="true" className="size-4 text-subtle" />
              {t("userMenu.university")}
            </Link>
          </div>
          <LanguagePicker
            label={t("userMenu.language")}
            current={locale}
            className="border-b border-border px-4 py-3"
          />
          <form action={signOut} className="p-1.5">
            <button
              type="submit"
              className="flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-body font-medium text-text hover:bg-surface-muted"
            >
              <LogOut aria-hidden="true" className="size-4 text-subtle" />
              {t("userMenu.signOut")}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/**
 * One button per language, the current one marked. Each submits the server action, which sets the
 * cookie, stores the choice on the account, and re-renders the page in the new language.
 */
export function LanguagePicker({
  label,
  current,
  realm = "practice",
  className,
}: {
  label: string;
  current: string;
  /** Which session the choice is saved on: the practice app's or the operator console's. */
  realm?: "practice" | "operator";
  className?: string;
}) {
  const groupId = useId();
  return (
    <form action={setLocale} className={className}>
      <input type="hidden" name="realm" value={realm} />
      <p id={groupId} className="text-label text-subtle">
        {label}
      </p>
      <div role="group" aria-labelledby={groupId} className="mt-1.5 flex flex-col gap-0.5">
        {LOCALES.map((code) => {
          const selected = code === current;
          return (
            <button
              key={code}
              type="submit"
              name="locale"
              value={code}
              lang={code}
              aria-pressed={selected}
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-control px-2 text-body text-text hover:bg-surface-muted",
                selected && "font-medium",
              )}
            >
              <Check
                aria-hidden="true"
                className={cn("size-4 shrink-0", selected ? "text-accent" : "invisible")}
                strokeWidth={2}
              />
              {LOCALE_NAMES[code]}
            </button>
          );
        })}
      </div>
    </form>
  );
}
