import { getT } from "@/i18n/server";

/** Shown on every page outside production (ADR 0003). Server-rendered; cannot be dismissed. */
export async function PreviewBanner({ appEnv }: { appEnv: string }) {
  const t = await getT("shell");
  return (
    <div
      role="note"
      aria-label={t("preview.label")}
      className="flex h-8 items-center justify-center gap-2 border-b border-warning-border bg-warning-bg px-4 text-label text-warning-fg"
    >
      <span className="font-semibold uppercase tracking-wide">{appEnv}</span>
      <span aria-hidden>·</span>
      <span className="font-medium">{t("preview.body")}</span>
    </div>
  );
}
