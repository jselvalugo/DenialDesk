"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { appHome, filterModules, type NavApp } from "./navigation";
import { toneClasses } from "./tones";

/** A module's icon tile: a colored glyph on its own light tint (DESIGN.md §4). Decorative. */
export function ModuleIcon({ app, size = "md" }: { app: NavApp; size?: "xs" | "sm" | "md" | "lg" }) {
  const Icon = app.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center border",
        size === "xs" ? "rounded-[4px]" : "rounded-control",
        toneClasses[app.tone],
        size === "xs" && "size-5",
        size === "sm" && "size-6",
        size === "md" && "size-8",
        size === "lg" && "size-10",
      )}
    >
      <Icon className={size === "lg" ? "size-5" : size === "xs" ? "size-3" : "size-4"} strokeWidth={1.75} />
    </span>
  );
}

/** Bolds the part of a label that matches the search, so results show why they matched. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? text.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-[2px] bg-accent-50 font-semibold text-text">
        {text.slice(at, at + q.length)}
      </mark>
      {text.slice(at + q.length)}
    </>
  );
}

const plannedTag = (
  <span className="rounded-[3px] border border-neutral-border bg-neutral-bg px-1 text-[0.6875rem] leading-4 font-medium text-neutral-fg">
    Planned
  </span>
);

/**
 * "Go to": one searchable table of every module and page this user can open: modules down the left
 * column, their pages as aligned rows on the right. Opened from the module button in the tab bar,
 * the header field, or Ctrl/⌘ K. A native modal <dialog> gives focus containment, Escape to close,
 * and an inert background.
 */
export function ModuleSwitcher({
  apps,
  currentId,
  open,
  onClose,
}: {
  apps: NavApp[];
  /** The module the user is in; marked "Current". */
  currentId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const titleId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      search.current?.focus();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  const close = () => {
    setQuery("");
    onClose();
  };

  const groups = filterModules(apps, query);
  const pageCount = groups.reduce((sum, group) => sum + group.items.length, 0);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={close}
      onClick={(event) => {
        if (event.target === dialog.current) close(); // backdrop click
      }}
      className="fixed inset-x-0 top-16 mx-auto max-h-[calc(100dvh-6rem)] w-[min(780px,calc(100vw-2rem))] overflow-hidden rounded-panel border border-border bg-surface p-0 text-text shadow-lg backdrop:bg-navy/40"
    >
      <div className="flex max-h-[calc(100dvh-6rem)] flex-col">
        <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border pr-3 pl-5">
          <Search aria-hidden="true" className="size-5 shrink-0 text-subtle" />
          <h2 id={titleId} className="sr-only">
            Go to
          </h2>
          <label className="flex-1">
            <span className="sr-only">Search modules and pages</span>
            <input
              ref={search}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Go to a module or page…"
              autoComplete="off"
              className="h-10 w-full bg-transparent text-title text-text outline-none placeholder:text-subtle"
            />
          </label>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="inline-flex size-8 items-center justify-center rounded-control text-muted hover:bg-surface-muted hover:text-text"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div
          aria-hidden="true"
          className="hidden shrink-0 grid-cols-[19rem_1fr] border-b border-border bg-surface-muted px-5 py-1.5 text-[0.6875rem] font-semibold tracking-wider text-subtle uppercase sm:grid"
        >
          <span>Module</span>
          <span className="pl-5">Pages</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <p role="status" className="px-5 py-8 text-body text-muted">
              Nothing matches “{query.trim()}”. Try a module or page name, like “Denial queue”.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {groups.map(({ app, items }) => {
                const home = appHome(app);
                const current = app.id === currentId;
                const heading = (
                  <>
                    <span className={cn(!home && "opacity-60")}>
                      <ModuleIcon app={app} size="md" />
                    </span>
                    <span className="min-w-0">
                      <span
                        id={`${titleId}-${app.id}-name`}
                        className={cn(
                          "flex items-center gap-2 text-heading font-semibold",
                          home ? "text-text" : "text-muted",
                        )}
                      >
                        <span>
                          <Highlight text={app.label} query={query} />
                        </span>
                        {!home && plannedTag}
                        {current && (
                          <span className="rounded-[3px] border border-tile-teal-border bg-tile-teal-bg px-1 text-[0.6875rem] leading-4 font-medium text-tile-teal-fg">
                            Current
                          </span>
                        )}
                      </span>
                      <span id={`${titleId}-${app.id}`} className="mt-0.5 block text-label text-muted">
                        {app.description}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li
                    key={app.id}
                    className={cn(
                      "grid grid-cols-1 gap-2 px-3 py-3 sm:grid-cols-[19rem_1fr] sm:gap-0",
                      current && "bg-accent-50/40",
                    )}
                  >
                    <h3>
                      {home ? (
                        <Link
                          href={home}
                          onClick={close}
                          aria-label={`${app.label} module`}
                          aria-describedby={`${titleId}-${app.id}`}
                          className="flex items-start gap-3 rounded-control px-2 py-1.5 transition-colors duration-100 hover:bg-surface-muted"
                        >
                          {heading}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 px-2 py-1.5">{heading}</div>
                      )}
                    </h3>
                    <ul
                      aria-labelledby={`${titleId}-${app.id}-name`}
                      className="flex flex-col content-start border-border pl-11 sm:border-l sm:pl-3"
                    >
                      {items.map((item) => {
                        const Icon = item.icon;
                        const row =
                          "flex h-8 items-center gap-2.5 rounded-control px-2 text-body whitespace-nowrap";
                        return (
                          <li key={item.href} className="min-w-0">
                            {item.available ? (
                              <Link
                                href={item.href}
                                onClick={close}
                                className={cn(
                                  row,
                                  "group font-medium text-text transition-colors duration-100 hover:bg-surface-muted",
                                )}
                              >
                                <Icon
                                  aria-hidden="true"
                                  className="size-4 shrink-0 text-subtle group-hover:text-accent"
                                  strokeWidth={1.75}
                                />
                                <span className="truncate">
                                  <Highlight text={item.label} query={query} />
                                </span>
                                <ArrowRight
                                  aria-hidden="true"
                                  className="ml-auto size-3.5 shrink-0 text-subtle opacity-0 transition-opacity duration-100 group-hover:opacity-100"
                                />
                              </Link>
                            ) : (
                              <span className={cn(row, "text-subtle")}>
                                <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                                <span className="truncate">
                                  <Highlight text={item.label} query={query} />
                                </span>
                                <span className="ml-auto">{plannedTag}</span>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex h-9 shrink-0 items-center justify-between gap-4 border-t border-border bg-surface-muted px-5 text-label text-subtle">
          <span role="status">
            {groups.length} {groups.length === 1 ? "module" : "modules"} · {pageCount}{" "}
            {pageCount === 1 ? "page" : "pages"}
          </span>
          <span aria-hidden="true" className="hidden items-center gap-3 sm:flex">
            <span>
              <kbd className="font-mono">Tab</kbd> move
            </span>
            <span>
              <kbd className="font-mono">Enter</kbd> open
            </span>
            <span>
              <kbd className="font-mono">Esc</kbd> close
            </span>
          </span>
        </div>
      </div>
    </dialog>
  );
}
