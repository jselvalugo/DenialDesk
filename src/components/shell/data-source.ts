import type { PatientsConnectionSummary } from "@/domain/integrations/connections";
import { en } from "@/i18n/messages/en";
import type { Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";

type ShellT = Translator<Messages["shell"]>;
/** English translator used when a caller doesn't have the request's language (e.g. unit tests). */
const englishShellT: ShellT = createTranslator(en.shell, "en");

export type DataSourceTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface DataSourceState {
  /** The bare state word ("Manual", "Awaiting approval", "Synced 5 minutes ago", …). */
  stateText: string;
  /** What the menu button shows ("Source: Manual", "Source: Acme EHR · Paused", …). */
  label: string;
  /** "Patients data source: <state>" (spec: erp-shell.md). */
  accessibleName: string;
  tone: DataSourceTone;
}

function relativeSince(at: Date, now: Date, t: ShellT): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
  if (minutes < 1) return t("dataSource.relative.justNow");
  if (minutes < 60) return t("dataSource.relative.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("dataSource.relative.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("dataSource.relative.daysAgo", { count: days });
}

/**
 * The tab-bar drop-down's label and state, from the connection summary alone (spec:
 * erp-shell.md "Data-source drop-down"). Pure — no PHI, no network, unit-tested directly.
 * `draft` and no connection both read as "Manual": a still-unsubmitted connection changes nothing
 * about where patients come from yet. `revoked` reads as its own state (not silently "Manual")
 * since it's history worth showing, and is also when "Connect an integration…" reappears.
 */
export function dataSourceState(
  summary: PatientsConnectionSummary | null,
  now: Date = new Date(),
  t: ShellT = englishShellT,
): DataSourceState {
  if (!summary || summary.status === "draft") {
    const state = t("dataSource.state.manual");
    return {
      stateText: state,
      label: t("dataSource.manual"),
      accessibleName: t("dataSource.accessibleName", { state }),
      tone: "neutral",
    };
  }

  const stateText = ((): string => {
    switch (summary.status) {
      case "revoked":
        return t("dataSource.state.revoked");
      case "pending_approval":
        return t("dataSource.state.awaitingApproval");
      case "paused":
        return t("dataSource.state.paused");
      case "error":
        return t("dataSource.state.error");
      case "active":
        return summary.lastSuccessAt
          ? t("dataSource.state.active", { relative: relativeSince(summary.lastSuccessAt, now, t) })
          : t("dataSource.state.neverSynced");
    }
  })();

  const tone: DataSourceTone =
    summary.status === "active"
      ? "success"
      : summary.status === "paused"
        ? "warning"
        : summary.status === "error"
          ? "danger"
          : summary.status === "pending_approval"
            ? "info"
            : "neutral";

  return {
    stateText,
    label: t("dataSource.label", { name: summary.displayName, state: stateText }),
    accessibleName: t("dataSource.accessibleName", { state: stateText }),
    tone,
  };
}

/** "Connect an integration…" shows only when no connection exists or the last one is revoked. */
export function canOfferNewConnection(summary: PatientsConnectionSummary | null): boolean {
  return summary === null || summary.status === "revoked";
}
