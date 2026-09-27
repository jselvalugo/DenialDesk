"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { keepSessionAlive, signOut } from "@/auth/actions";
import { SESSION_IDLE_MS, SESSION_TOUCH_MS, SESSION_WARNING_MS } from "@/auth/policy";
import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n/client";

// Sign out before the server could, given its activity clock may lag by up to SESSION_TOUCH_MS.
const CLIENT_IDLE_MS = SESSION_IDLE_MS - SESSION_TOUCH_MS;

/**
 * Warns before the 15-minute idle timeout (R-7.2.7, DESIGN.md §12). The server enforces the
 * timeout regardless; this only keeps people from losing work by surprise.
 */
export function SessionTimeout({
  keepAlive = keepSessionAlive,
  signOutAction = signOut,
  timeoutHref = "/login?reason=timeout",
}: {
  /** The operator console passes its own session's actions and sign-in page. */
  keepAlive?: () => Promise<boolean>;
  signOutAction?: () => Promise<void>;
  timeoutHref?: string;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT("shell");
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const lastActive = useRef(0); // set on mount by the pathname effect
  const stayButton = useRef<HTMLButtonElement>(null);

  const reset = useCallback(() => {
    lastActive.current = Date.now();
    setSecondsLeft(null);
  }, []);

  // Navigations and form submissions are server round trips that slide the idle window.
  useEffect(() => {
    lastActive.current = Date.now();
  }, [pathname]);

  useEffect(() => {
    const onActivity = () => (lastActive.current = Date.now());
    window.addEventListener("popstate", onActivity);
    document.addEventListener("submit", onActivity);
    const timer = window.setInterval(() => {
      const remaining = CLIENT_IDLE_MS - (Date.now() - lastActive.current);
      if (remaining <= 0) {
        window.clearInterval(timer);
        router.push(timeoutHref);
      } else if (remaining <= SESSION_WARNING_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000));
      }
    }, 1000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("popstate", onActivity);
      document.removeEventListener("submit", onActivity);
    };
  }, [router, timeoutHref]);

  const warning = secondsLeft !== null;
  useEffect(() => {
    if (warning) stayButton.current?.focus();
  }, [warning]);

  if (secondsLeft === null) return null;
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="timeout-title"
        aria-describedby="timeout-body"
        className="w-[420px] rounded-panel border border-border bg-surface p-6 shadow-lg"
      >
        <h2 id="timeout-title" className="text-heading font-semibold text-text">
          {t("timeout.title")}
        </h2>
        <p id="timeout-body" className="mt-2 text-body text-muted">
          {t("timeout.body")}{" "}
          <span className="tabular font-medium text-text">
            {minutes}:{seconds}
          </span>
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <form action={signOutAction}>
            <Button type="submit" variant="ghost">
              {t("timeout.signOut")}
            </Button>
          </form>
          <Button
            ref={stayButton}
            variant="primary"
            onClick={async () => ((await keepAlive()) ? reset() : router.push(timeoutHref))}
          >
            {t("timeout.stay")}
          </Button>
        </div>
      </div>
    </div>
  );
}
