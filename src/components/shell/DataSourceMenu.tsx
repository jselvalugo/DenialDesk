"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useActionState, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  "flex h-8 w-full items-center rounded-control px-2.5 text-left text-body font-medium text-text hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none";

const PANEL_WIDTH = 320;

interface Position {
  top: number;
  left: number;
}

/**
 * The tab-bar data-source menu (docs/specs/erp-shell.md "Data-source drop-down"): sits right after
 * a tab with a `dataSource` slot. Every role sees the current state and last successful sync;
 * administrators also get "Connect an integration…"/"Manage connection" and pause/resume. Menu
 * visibility is not access control — every action re-checks the role on the server.
 *
 * The panel is portaled to `document.body` (security/correctness review PR #81): the tab bar's
 * `<nav>` scrolls horizontally (`overflow-x-auto`, GlobalHeader.tsx) at narrow widths, which would
 * otherwise clip an `absolute`-positioned panel to that scroll box. Positioned from the trigger
 * button's own rect instead of relying on DOM ancestry.
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
  const [position, setPosition] = useState<Position | null>(null);
  // Deferred to the client (React hydration-safe pattern): the server and the pre-hydration client
  // render both use `null` here, so the markup matches; only after mount does a real clock apply,
  // avoiding a relative-time ("Synced 5 minutes ago") hydration mismatch (security review PR #81).
  const [mountedNow, setMountedNow] = useState<Date | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  // A stable "now" before mount: the connection's own last-success time reads as "just now" rather
  // than a huge, alarming placeholder like "3000 days ago".
  const state = dataSourceState(summary, mountedNow ?? summary?.lastSuccessAt ?? new Date(), t);
  const [pauseState, pauseAction] = useActionState(pauseConnectionAction, {});
  const [resumeState, resumeAction] = useActionState(resumeConnectionAction, {});

  // Pause/resume submit through a `<form>` inside this same client component (no page
  // navigation), so a successful action re-renders it in place rather than remounting it: `open`
  // would otherwise stay stuck at `true` with a now-stale menu behind it, so a later click on the
  // trigger button would toggle it *closed* instead of opening a fresh one (found via this
  // component's own e2e coverage). Left open on an error, so the message above stays visible.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!pauseState.error) setOpen(false);
  }, [pauseState]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!resumeState.error) setOpen(false);
  }, [resumeState]);

  useEffect(() => {
    // One-time, client-only clock read for the hydration-safe relative-time pattern above; there
    // is no external system to subscribe to, so the usual "don't setState in an effect" guidance
    // doesn't apply here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMountedNow(new Date());
  }, []);

  const updatePosition = () => {
    const rect = button.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({
      top: rect.bottom + 4,
      left: Math.min(rect.left, Math.max(8, window.innerWidth - PANEL_WIDTH - 8)),
    });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const contains = (target: EventTarget | null) =>
      (button.current?.contains(target as Node) ?? false) ||
      (panel.current?.contains(target as Node) ?? false);
    const close = () => {
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!contains(event.target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!contains(event.target)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      const items = panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      if (!items || items.length === 0) return;
      const list = Array.from(items);
      const currentIndex = list.indexOf(document.activeElement as HTMLElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        list[(currentIndex + 1 + list.length) % list.length]!.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        list[(currentIndex - 1 + list.length) % list.length]!.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        list[0]!.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        list[list.length - 1]!.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Move focus into the panel once it exists (menu semantics), without stealing it before the
    // portal has mounted.
    const first = panel.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
  }, [open]);

  return (
    <div className="relative flex shrink-0 items-stretch border-r border-sidebar-border">
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

      {open &&
        position &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={panel}
            id={panelId}
            role="menu"
            data-chrome="light"
            // The menu's accessible name matches the trigger button's own `aria-label` (spec:
            // "Patients data source: <state>") rather than the visible "Current state" caption
            // below — a `role="menu"` panel needs its own name, and reusing the button's is the
            // simplest choice that keeps them in sync (e2e correctness fix, review PR #81 item 2).
            aria-label={state.accessibleName}
            style={{ position: "fixed", top: position.top, left: position.left, width: PANEL_WIDTH }}
            className="z-50 rounded-panel border border-border bg-surface text-text shadow-lg"
          >
            <div className="border-b border-border px-3.5 py-2.5">
              <p className="text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase">
                {t("dataSource.menu.currentState")}
              </p>
              {summary && <p className="text-body font-medium text-text">{summary.displayName}</p>}
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
                    tabIndex={-1}
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
                    tabIndex={-1}
                    onClick={() => setOpen(false)}
                    className={menuItemClass}
                  >
                    {t("dataSource.menu.manageConnection")}
                  </Link>
                )}
                {summary?.status === "active" && (
                  <form action={pauseAction}>
                    <input type="hidden" name="connectionId" value={summary.id} />
                    <button type="submit" role="menuitem" tabIndex={-1} className={menuItemClass}>
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
                    <button type="submit" role="menuitem" tabIndex={-1} className={menuItemClass}>
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
                    tabIndex={-1}
                    onClick={() => setOpen(false)}
                    className={menuItemClass}
                  >
                    {t("dataSource.menu.syncHistory")}
                  </Link>
                )}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
