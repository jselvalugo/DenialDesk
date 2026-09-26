"use client";

import { ModuleIcon } from "./ModuleSwitcher";
import { useShellLocation } from "./ShellContext";

/** The current module's icon tile, beside a page title; nothing outside the app shell. */
export function PageIcon() {
  const location = useShellLocation();
  return location ? <ModuleIcon app={location.app} size="lg" /> : null;
}

/** "App · Page" line above a page title, so a detail page still says where it lives. */
export function PageEyebrow({ title }: { title: string }) {
  const location = useShellLocation();
  if (!location) return null;
  const { app, item } = location;
  const text = item && item.label !== title ? `${app.label} · ${item.label}` : app.label;
  return <p className="text-label font-semibold tracking-wider text-muted uppercase">{text}</p>;
}
