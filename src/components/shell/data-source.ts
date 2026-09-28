import type { DataSourceSummary } from "@/domain/integrations/connections";
import type { Formatters } from "@/i18n/format";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";

// Label logic for the tab-bar data-source drop-down (specs/erp-shell.md "Data-source drop-down"),
// kept pure so every state is unit-tested. The status is always text, never color alone.

export type DataSourceState =
  | "manual"
  | "synced"
  | "notSynced"
  | "running"
  | "awaitingApproval"
  | "paused"
  | "needsAttention"
  | "revoked";

type ShellT = Translator<Messages["shell"]>;

export function dataSourceState(summary: DataSourceSummary | null): DataSourceState {
  if (!summary) return "manual";
  switch (summary.status) {
    case "active":
      if (summary.lastRunStatus === "queued" || summary.lastRunStatus === "running") return "running";
      return summary.lastSuccessAt ? "synced" : "notSynced";
    case "pending_approval":
      return "awaitingApproval";
    case "paused":
      return "paused";
    case "error":
      return "needsAttention";
    case "revoked":
      return "revoked";
    default:
      // A draft is never a source (connectionSummary never returns one).
      return "manual";
  }
}

const STATE_KEYS: Record<Exclude<DataSourceState, "synced">, MessageKey<"shell">> = {
  manual: "dataSource.state.manual",
  notSynced: "dataSource.state.notSynced",
  running: "dataSource.state.running",
  awaitingApproval: "dataSource.state.awaitingApproval",
  paused: "dataSource.state.paused",
  needsAttention: "dataSource.state.needsAttention",
  revoked: "dataSource.state.revoked",
};

/** The state in words, e.g. "Synced 5 minutes ago" or "Awaiting approval". */
export function dataSourceStateText(
  summary: DataSourceSummary | null,
  t: ShellT,
  format: Pick<Formatters, "relative">,
  now: Date,
): string {
  const state = dataSourceState(summary);
  if (state === "synced") {
    return t("dataSource.state.synced", { when: format.relative(new Date(summary!.lastSuccessAt!), now) });
  }
  return t(STATE_KEYS[state]);
}

/** The button's visible text and its accessible name ("Patients data source: …"). */
export function dataSourceButton(
  summary: DataSourceSummary | null,
  table: "patients",
  t: ShellT,
  format: Pick<Formatters, "relative">,
  now: Date,
): { state: string; ariaLabel: string } {
  const state = dataSourceStateText(summary, t, format, now);
  const named = summary ? t("dataSource.ariaState", { name: summary.displayName, state }) : state;
  return {
    state,
    ariaLabel: t("dataSource.ariaLabel", { table: t(`dataSource.table.${table}`), state: named }),
  };
}
