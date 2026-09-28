"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { pauseConnectionAction, resumeConnectionAction } from "@/app/(app)/settings/integrations/actions";
import { StepUpLink } from "@/components/auth/StepUpLink";
import type { PatientsConnectionSummary } from "@/domain/integrations/connections";
import { useFormat, useT } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { canOfferNewConnection, dataSourceState, type DataSourceTone } from "./data-source";

const DOT_CLASSES: Record<DataSourceTone, string> = {
  neutral: "bg-sidebar-muted",
  info: "bg-sky-400",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  danger: "bg-red-400",
};

const menuItemClass =
  "flex h-8 w-full items-center rounded-control px-2.5 text-left text-body font-medium text-text hover:bg-surface-muted";

/**
 * The tab-bar data-source menu (docs/specs/erp-shell.md "Data-source drop-down"): sits right after
 * a tab with a `dataSource` slot. Every role sees the current state and last successful sync;
 * administrators also get "Connect an integration…"/"Manage connection" and pause/resume. Menu
 * visibility is not access control — every action re-checks the role on the server.
 */
export function DataSourceMenu({
  summary,
  canManage,
}: {
  summary: PatientsConnectionSummary | null;
  canManage: boolean;
}) {
  const t = useT("shell");
  const ts = useT("settings");
  const f = useFormat();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const state = dataSourceState(summary);
  const [pauseState, pauseAction] = useActionState(pauseConnectionAction, {});
  const [resumeState, resumeAction] = useActionState(resumeConnectionAction, {});

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
      className="relative flex shrink-0 items-stretch border-r border-sidebar-border"
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={state.accessibleName}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 px-3.5 text-body font-medium text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-active/60 hover:text-white focus-visible:-outline-offset-2"
      >
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", DOT_CLASSES[state.tone])} />
        <span className="max-w-52 truncate">{state.label}</span>
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-sidebar-muted" strokeWidth={2} />
      </button>

      {open && (
        <div
          id={panelId}
          role="menu"
          aria-label={state.accessibleName}
          className="absolute top-full left-0 z-40 mt-1 w-80 rounded-panel border border-border bg-surface text-text shadow-sm"
        >
          <div className="border-b border-border px-3.5 py-2.5">
            <p className="text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase">
              {t("dataSource.menu.currentState")}
            </p>
            <p className="text-body text-text">{state.stateText}</p>
            {summary?.lastSuccessAt && (
              <p className="mt-1 text-label text-muted">
                {t("dataSource.menu.lastSuccessfulSync")}: {f.dateTime(summary.lastSuccessAt)}
              </p>
            )}
          </div>

          {canManage && (
            <div className="flex flex-col gap-0.5 p-1.5" role="none">
              {canOfferNewConnection(summary) && (
                <Link
                  href="/settings/integrations/new"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={menuItemClass}
                >
                  {t("dataSource.menu.connectIntegration")}
                </Link>
              )}
              {summary && summary.status !== "revoked" && (
                <Link
                  href={`/settings/integrations/${summary.id}`}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={menuItemClass}
                >
                  {t("dataSource.menu.manageConnection")}
                </Link>
              )}
              {summary?.status === "active" && (
                <form action={pauseAction}>
                  <input type="hidden" name="connectionId" value={summary.id} />
                  <button type="submit" role="menuitem" className={menuItemClass}>
                    {t("dataSource.menu.pauseSync")}
                  </button>
                  {pauseState.error && (
                    <p role="alert" className="px-2.5 text-label font-medium text-danger-fg">
                      {pauseState.error}
                    </p>
                  )}
                </form>
              )}
              {(summary?.status === "paused" || summary?.status === "error") && (
                <form action={resumeAction}>
                  <input type="hidden" name="connectionId" value={summary.id} />
                  <button type="submit" role="menuitem" className={menuItemClass}>
                    {t("dataSource.menu.resumeSync")}
                  </button>
                  {resumeState.error && (
                    <p role="alert" className="px-2.5 text-label font-medium text-danger-fg">
                      {resumeState.error}
                    </p>
                  )}
                  {resumeState.stepUpRequired && (
                    <p className="px-2.5 text-label">
                      <StepUpLink label={ts("integrations.action.verifyIdentity")} />
                    </p>
                  )}
                </form>
              )}
              {summary && (
                <Link
                  href={`/settings/integrations/${summary.id}/runs`}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={menuItemClass}
                >
                  {t("dataSource.menu.syncHistory")}
                </Link>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
