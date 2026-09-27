"use client";

import { eyebrowText } from "./eyebrow";
import { ModuleIcon } from "./ModuleSwitcher";
import { useShellLocation } from "./ShellContext";

/** The current module's icon tile, beside a page title; nothing outside the app shell. */
export function PageIcon() {
  const location = useShellLocation();
  return location ? <ModuleIcon app={location.app} size="lg" /> : null;
}

/** "Module · Page" line above a page title, so a detail page still says where it lives. */
export function PageEyebrow({ title, page }: { title?: string; page?: string }) {
  const location = useShellLocation();
  if (!location) return null;
  const text = eyebrowText(location.app.label, location.item?.label, title, page);
  return <p className="text-label font-semibold tracking-wider text-muted uppercase">{text}</p>;
}
