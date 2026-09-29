"use client";

import { useEffect } from "react";

/**
 * The "letter saved" confirmation. It drops `?saved=1` from the address bar after the first render, so a
 * reload or a shared link does not show it again. The text is a localized constant: no PHI (SC-B5).
 */
export function SavedNotice({ text }: { text: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("saved")) {
      url.searchParams.delete("saved");
      window.history.replaceState(window.history.state, "", url.pathname + url.search);
    }
  }, []);
  return (
    <p
      role="status"
      className="rounded-control border border-success-border bg-success-bg px-3 py-2 text-body text-success-fg"
    >
      {text}
    </p>
  );
}
