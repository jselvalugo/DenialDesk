"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Database } from "lucide-react";
import { useFormat, useT } from "@/i18n/client";
import { dataSourceAdminLink, dataSourceButton, dataSourceState } from "./data-source";
import { useShellDataSources } from "./ShellContext";

/** Panel width (w-80) and the gap it keeps from the viewport edge. */
const PANEL_WIDTH = 320;
const EDGE = 8;

/**
 * The data-source drop-down beside a synced table's tab (specs/erp-shell.md; ADR 0010): where the
 * table's data comes from and when it last synced, for every role; administrators also get a link to
 * connect or manage. A disclosure like the user menu (no menu library in the project): Escape, an
 * outside click, scrolling, or tabbing away closes it. The panel is `fixed`, anchored to the button,
 * because the tab bar scrolls sideways and would clip it. Sync now, pause/resume, and sync history
 * join the menu with PI2a/PI2b, when those actions exist.
 */
export function DataSourceMenu({ table }: { table: "patients" }) {
  const sources = useShellDataSources();
  const t = useT("shell");
  const format = useFormat();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
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
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  if (!sources || sources[table] === undefined) return null;
  const summary = sources[table] ?? null;
  const now = new Date(sources.renderedAt);
  const { state, ariaLabel } = dataSourceButton(summary, table, t, format, now);
  const kind = dataSourceState(summary);
  const adminLink = dataSourceAdminLink(summary, sources.canManageIntegrations);
  // DESIGN.md §10: relative time is never alone — the absolute time is in the panel and on hover.
  const absolute = summary?.lastSuccessAt ? format.dateTime(new Date(summary.lastSuccessAt)) : undefined;

  const toggle = () => {
    if (!open && button.current) {
      const rect = button.current.getBoundingClientRect();
      // Clamped so the whole panel stays on screen (narrow windows, 400% zoom, a scrolled tab bar).
      const maxLeft = Math.max(EDGE, window.innerWidth - PANEL_WIDTH - EDGE);
      setPosition({ top: rect.bottom + 4, left: Math.min(Math.max(rect.left, EDGE), maxLeft) });
    }
    setOpen((value) => !value);
  };

  return (
    <div
      ref={root}
      className="flex"
      onBlur={(event) => {
        if (!root.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
        title={absolute}
        className="group flex max-w-[28rem] items-center gap-1.5 px-3 text-label whitespace-nowrap text-sidebar-fg transition-colors duration-100 hover:bg-sidebar-active/60 hover:text-white focus-visible:-outline-offset-2"
      >
        <Database aria-hidden="true" className="size-3.5 shrink-0 text-sidebar-muted" strokeWidth={1.75} />
        <span className="text-sidebar-muted group-hover:text-sidebar-fg">{t("dataSource.source")}</span>
        {summary ? (
          <>
            {/* A long connection name truncates here; the full name is in the panel. */}
            <span className="min-w-0 truncate font-medium text-white">{summary.displayName}</span>
            <span aria-hidden="true" className="text-sidebar-muted group-hover:text-sidebar-fg">
              ·
            </span>
            <span className="shrink-0">{state}</span>
          </>
        ) : (
          <span className="font-medium text-white">{state}</span>
        )}
        <ChevronDown aria-hidden="true" className="size-3.5 shrink-0 text-sidebar-muted" strokeWidth={2} />
      </button>
      {open && position && (
        // tabIndex -1: a click on the panel's text keeps focus inside, so onBlur doesn't close it.
        // data-chrome="light": focus rings inside return to the blue (the tab bar's teal is < 3:1 here).
        <div
          id={panelId}
          tabIndex={-1}
          data-chrome="light"
          style={{ top: position.top, left: position.left }}
          className="fixed z-40 w-80 max-w-[calc(100vw-16px)] rounded-panel border border-border bg-surface text-text shadow-sm outline-none"
        >
          <div className="border-b border-border px-4 py-3">
            <p className="text-label font-semibold tracking-wide text-subtle uppercase">
              {t("dataSource.panel.title")}
            </p>
            <p className="mt-1 text-body break-words">
              {summary === null
                ? t("dataSource.panel.manual")
                : kind === "revoked"
                  ? t("dataSource.panel.revoked", { name: summary.displayName })
                  : t("dataSource.panel.connected", { name: summary.displayName })}
            </p>
          </div>
          {summary && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-b border-border px-4 py-3 text-label">
              <dt className="text-muted">{t("dataSource.panel.status")}</dt>
              <dd className="font-medium">{state}</dd>
              <dt className="text-muted">{t("dataSource.panel.lastSync")}</dt>
              <dd className="tabular-nums">
                {summary.lastSuccessAt
                  ? format.dateTime(new Date(summary.lastSuccessAt))
                  : t("dataSource.panel.never")}
              </dd>
              <dt className="text-muted">{t("dataSource.panel.lastRun")}</dt>
              <dd>
                {t(summary.lastRunStatus ? `dataSource.run.${summary.lastRunStatus}` : "dataSource.run.none")}
              </dd>
            </dl>
          )}
          {adminLink && (
            <div className="p-1.5">
              <Link
                href={adminLink.href}
                onClick={() => setOpen(false)}
                className="flex h-9 w-full items-center rounded-control px-2.5 text-body font-medium text-link hover:bg-surface-muted"
              >
                {adminLink.kind === "connect"
                  ? t("dataSource.action.connect")
                  : t("dataSource.action.settings")}
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
