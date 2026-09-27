"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { CircleCheck, GraduationCap, X } from "lucide-react";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { ProgramSummary } from "@/domain/university/offer";
import { useFormat, useT } from "@/i18n/client";
import { requestUniversityAccess, type RequestAccessState } from "./actions";

/**
 * The access prompt on the course catalog (spec: denialdesk-university.md, "Access prompt"). A
 * native modal <dialog> that opens on every visit (owner request 2026-09-27: it always shows),
 * states how long the program is and that access starts at the offer price, and lets the user
 * request access or continue. Nothing is stored about dismissals, so it shows again next time.
 */
export function AccessPrompt({
  summary,
  priceFromCents,
}: {
  summary: ProgramSummary;
  priceFromCents: number;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const t = useT("university");
  const tc = useT("common");
  const f = useFormat();
  const [state, action] = useActionState<RequestAccessState, FormData>(requestUniversityAccess, {});

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const close = () => dialog.current?.close();

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClick={(event) => {
        if (event.target === dialog.current) close(); // backdrop click
      }}
      className="fixed inset-x-0 top-24 mx-auto w-[min(560px,calc(100vw-2rem))] rounded-panel border border-border bg-surface p-0 text-text shadow-lg backdrop:bg-navy/40"
    >
      <div className="flex items-start gap-4 border-b border-border px-5 py-4">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-control border border-tile-teal-border bg-tile-teal-bg text-tile-teal-fg"
        >
          <GraduationCap className="size-5" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-label font-semibold tracking-wider text-muted uppercase">{t("eyebrow")}</p>
          <h2 id={titleId} className="text-title font-semibold text-primary">
            {t("access.title")}
          </h2>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label={tc("action.close")}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface-muted hover:text-text"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div id={descriptionId} className="flex flex-col gap-4 px-5 py-4 text-body text-text">
        <p>{t("access.body")}</p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-panel border border-border bg-surface-muted px-4 py-3 sm:grid-cols-4">
          <div>
            <dt className="text-[0.6875rem] font-semibold tracking-wider text-muted uppercase">
              {t("access.coursesLabel")}
            </dt>
            <dd className="font-mono text-body tabular-nums">{f.number(summary.courses)}</dd>
          </div>
          <div>
            <dt className="text-[0.6875rem] font-semibold tracking-wider text-muted uppercase">
              {t("catalog.lessonsLabel")}
            </dt>
            <dd className="font-mono text-body tabular-nums">{f.number(summary.lessons)}</dd>
          </div>
          <div>
            <dt className="text-[0.6875rem] font-semibold tracking-wider text-muted uppercase">
              {t("access.lengthLabel")}
            </dt>
            <dd className="font-mono text-body tabular-nums">
              {t("access.lengthMinutes", { count: summary.minutes })}
            </dd>
          </div>
          <div>
            <dt className="text-[0.6875rem] font-semibold tracking-wider text-muted uppercase">
              {t("access.wikiLabel")}
            </dt>
            <dd className="font-mono text-body tabular-nums">{f.number(summary.wikiArticles)}</dd>
          </div>
        </dl>
        <p className="text-heading font-semibold text-text">
          {t("access.price", { price: f.cents(priceFromCents) })}
        </p>
        <p className="text-label text-muted">{t("access.terms")}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
        {state.requested ? (
          <p role="status" className="inline-flex items-center gap-1.5 text-body font-medium text-success-fg">
            <CircleCheck aria-hidden="true" className="size-4" strokeWidth={2} />
            {t("access.requested")}
          </p>
        ) : (
          <form action={action}>
            <SubmitButton variant="primary" pendingLabel={tc("action.saving")}>
              {t("access.request")}
            </SubmitButton>
          </form>
        )}
        <button
          type="button"
          onClick={close}
          className="inline-flex h-8 items-center rounded-control px-3 text-body font-medium text-muted hover:bg-surface-muted hover:text-text"
        >
          {t("access.continue")}
        </button>
      </div>
    </dialog>
  );
}
