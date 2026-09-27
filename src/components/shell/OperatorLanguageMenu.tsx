"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Languages } from "lucide-react";
import { useLocale, useT } from "@/i18n/client";
import { LOCALE_NAMES } from "@/i18n/config";
import { LanguagePicker } from "./UserMenu";

/** The operator console has no user menu, so its header carries the language choice on its own. */
export function OperatorLanguageMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const t = useT("shell");
  const locale = useLocale();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("userMenu.language")}
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 items-center gap-1.5 rounded-control px-2 text-body text-white/85 hover:bg-sidebar-active focus-visible:-outline-offset-2"
      >
        <Languages aria-hidden="true" className="size-4" strokeWidth={1.75} />
        <span lang={locale}>{LOCALE_NAMES[locale]}</span>
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
      {open && (
        <div
          id={panelId}
          data-chrome="light"
          className="absolute top-full right-0 z-40 mt-1 w-56 rounded-panel border border-border bg-surface text-text shadow-sm"
        >
          <LanguagePicker label={t("userMenu.language")} current={locale} className="px-4 py-3" />
        </div>
      )}
    </div>
  );
}
