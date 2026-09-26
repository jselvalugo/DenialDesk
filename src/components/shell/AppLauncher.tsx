"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { appHome, type NavApp } from "./navigation";
import { toneClasses } from "./tones";

export function AppIcon({ app, size = "md" }: { app: NavApp; size?: "xs" | "sm" | "md" | "lg" }) {
  const Icon = app.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-white",
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

function includes(text: string, query: string) {
  return text.toLowerCase().includes(query);
}

/**
 * The app launcher (ERP-style module switcher): every app and page this user can open, searchable.
 * A native modal <dialog> gives focus containment, Escape to close, and an inert background.
 */
export function AppLauncher({ apps, open, onClose }: { apps: NavApp[]; open: boolean; onClose: () => void }) {
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

  const q = query.trim().toLowerCase();
  const visibleApps = q
    ? apps.filter(
        (app) =>
          includes(app.label, q) ||
          includes(app.description, q) ||
          app.items.some((item) => includes(item.label, q)),
      )
    : apps;
  const pageGroups = apps
    .map((app) => ({
      app,
      items: app.items.filter((item) => !q || includes(item.label, q) || includes(app.label, q)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={close}
      onClick={(event) => {
        if (event.target === dialog.current) close(); // backdrop click
      }}
      className="fixed inset-x-0 top-16 mx-auto max-h-[calc(100dvh-6rem)] w-[min(960px,calc(100vw-2rem))] overflow-hidden rounded-panel border border-border bg-surface p-0 text-text shadow-lg backdrop:bg-navy/40"
    >
      <div className="flex max-h-[calc(100dvh-6rem)] flex-col">
        <div className="flex items-center gap-4 border-b border-border px-5 py-4">
          <h2 id={titleId} className="shrink-0 text-title font-semibold text-primary">
            App launcher
          </h2>
          <label className="relative flex-1">
            <span className="sr-only">Search apps and pages</span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
            />
            <input
              ref={search}
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search apps and pages"
              autoComplete="off"
              className="h-9 w-full rounded-control border border-border-strong bg-surface pr-3 pl-9 text-body placeholder:text-subtle"
            />
          </label>
          <button
            type="button"
            onClick={close}
            aria-label="Close app launcher"
            className="inline-flex size-8 items-center justify-center rounded-control text-muted hover:bg-surface-muted hover:text-text"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5">
          <section aria-labelledby={`${titleId}-apps`}>
            <h3
              id={`${titleId}-apps`}
              className="mb-3 text-label font-semibold tracking-wider text-muted uppercase"
            >
              Apps
            </h3>
            {visibleApps.length === 0 ? (
              <p className="text-body text-muted">No app matches “{query.trim()}”. Try a page name.</p>
            ) : (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
                {visibleApps.map((app) => {
                  const home = appHome(app);
                  const body = (
                    <>
                      <AppIcon app={app} size="lg" />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 text-heading font-semibold text-text">
                          {app.label}
                          {!home && <span className="text-label font-normal text-subtle">Planned</span>}
                        </span>
                        <span id={`${titleId}-${app.id}`} className="mt-0.5 block text-label text-muted">
                          {app.description}
                        </span>
                      </span>
                    </>
                  );
                  const tile = "flex h-full items-start gap-3 rounded-panel border border-border p-3";
                  return (
                    <li key={app.id}>
                      {home ? (
                        <Link
                          href={home}
                          onClick={close}
                          aria-label={`${app.label} app`}
                          aria-describedby={`${titleId}-${app.id}`}
                          className={cn(
                            tile,
                            "transition-colors duration-100 hover:border-focus hover:bg-surface-muted",
                          )}
                        >
                          {body}
                        </Link>
                      ) : (
                        <div className={cn(tile, "bg-surface-muted")}>{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby={`${titleId}-pages`} className="mt-6">
            <h3
              id={`${titleId}-pages`}
              className="mb-2 text-label font-semibold tracking-wider text-muted uppercase"
            >
              All pages
            </h3>
            {pageGroups.length === 0 ? (
              <p className="text-body text-muted">No page matches “{query.trim()}”.</p>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-4">
                {pageGroups.map(({ app, items }) => (
                  <div key={app.id}>
                    <h4 className="mb-1 flex items-center gap-2 px-2 text-label font-semibold text-text">
                      <AppIcon app={app} size="xs" />
                      {app.label}
                    </h4>
                    <ul className="space-y-0.5">
                      {items.map((item) => {
                        const Icon = item.icon;
                        const icon = (
                          <Icon
                            aria-hidden="true"
                            className="size-4 shrink-0 text-subtle"
                            strokeWidth={1.75}
                          />
                        );
                        const row = "flex h-8 items-center gap-2.5 rounded-control px-2 text-body";
                        return (
                          <li key={item.href}>
                            {item.available ? (
                              <Link
                                href={item.href}
                                onClick={close}
                                className={cn(
                                  row,
                                  "font-medium text-link hover:bg-surface-muted hover:underline",
                                )}
                              >
                                {icon}
                                {item.label}
                              </Link>
                            ) : (
                              <span className={cn(row, "text-muted")}>
                                {icon}
                                <span className="flex-1">{item.label}</span>
                                <span className="text-label text-subtle">Planned</span>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </dialog>
  );
}
