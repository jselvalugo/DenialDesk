"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
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

/**
 * "Go to": one searchable, grouped list of every module and page this user can open. Opened from the
 * module button in the tab bar, the header field, or Ctrl/⌘ K. A native modal <dialog> gives focus
 * containment, Escape to close, and an inert background.
 */
export function ModuleSwitcher({
  apps,
  open,
  onClose,
}: {
  apps: NavApp[];
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

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={close}
      onClick={(event) => {
        if (event.target === dialog.current) close(); // backdrop click
      }}
      className="fixed inset-x-0 top-16 mx-auto max-h-[calc(100dvh-6rem)] w-[min(720px,calc(100vw-2rem))] overflow-hidden rounded-panel border border-border bg-surface p-0 text-text shadow-lg backdrop:bg-navy/40"
    >
      <div className="flex max-h-[calc(100dvh-6rem)] flex-col">
        <div className="flex items-center gap-4 border-b border-border px-5 py-3">
          <h2 id={titleId} className="shrink-0 font-serif text-title font-semibold text-primary">
            Go to
          </h2>
          <label className="relative flex-1">
            <span className="sr-only">Search modules and pages</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            />
            <input
              ref={search}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Module or page name"
              autoComplete="off"
              className="h-9 w-full rounded-control border border-border-strong bg-surface pr-3 pl-9 text-body placeholder:text-subtle"
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

        <div className="overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-5 py-6 text-body text-muted">
              Nothing matches “{query.trim()}”. Try a module or page name, like “Denial queue”.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {groups.map(({ app, items }) => {
                const home = appHome(app);
                const heading = (
                  <>
                    <ModuleIcon app={app} size="md" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-heading font-semibold text-text">
                        {app.label}
                        {!home && <span className="text-label font-normal text-subtle">Planned</span>}
                      </span>
                      <span id={`${titleId}-${app.id}`} className="block text-label text-muted">
                        {app.description}
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={app.id} className="px-5 py-3">
                    {home ? (
                      <Link
                        href={home}
                        onClick={close}
                        aria-label={`${app.label} module`}
                        aria-describedby={`${titleId}-${app.id}`}
                        className="-mx-2 flex items-center gap-3 rounded-control px-2 py-1 transition-colors duration-100 hover:bg-surface-muted"
                      >
                        {heading}
                      </Link>
                    ) : (
                      <div className="-mx-2 flex items-center gap-3 px-2 py-1">{heading}</div>
                    )}
                    <ul className="mt-2 flex flex-wrap gap-2 pl-11">
                      {items.map((item) => {
                        const Icon = item.icon;
                        const icon = (
                          <Icon aria-hidden="true" className="size-4 shrink-0" strokeWidth={1.75} />
                        );
                        const row =
                          "flex h-8 items-center gap-2 rounded-control border px-2.5 text-body whitespace-nowrap";
                        return (
                          <li key={item.href}>
                            {item.available ? (
                              <Link
                                href={item.href}
                                onClick={close}
                                className={cn(
                                  row,
                                  "border-border bg-surface font-medium text-text transition-colors duration-100 hover:border-focus hover:bg-surface-muted",
                                )}
                              >
                                <span className="text-subtle">{icon}</span>
                                {item.label}
                              </Link>
                            ) : (
                              <span className={cn(row, "border-dashed border-border text-muted")}>
                                {icon}
                                <span>{item.label}</span>
                                <span className="text-label text-subtle">Planned</span>
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
      </div>
    </dialog>
  );
}
