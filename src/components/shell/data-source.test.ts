import { describe, expect, it } from "vitest";
import type { DataSourceSummary } from "@/domain/integrations/connections";
import { createFormatters } from "@/i18n/format";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { createTranslator } from "@/i18n/translate";
import { dataSourceButton, dataSourceState } from "./data-source";

const t = createTranslator(en.shell, "en");
const format = createFormatters("en");
const now = new Date("2026-09-28T18:00:00Z");

function summary(overrides: Partial<DataSourceSummary> = {}): DataSourceSummary {
  return {
    connectionId: "00000000-0000-4000-8000-000000000001",
    displayName: "Main EHR",
    status: "active",
    lastSuccessAt: null,
    lastRunStatus: null,
    ...overrides,
  };
}

describe("dataSourceState (specs/erp-shell.md data-source drop-down)", () => {
  it.each([
    [null, "manual"],
    [summary({ status: "active", lastSuccessAt: "2026-09-28T17:55:00Z" }), "synced"],
    [summary({ status: "active" }), "notSynced"],
    [
      summary({ status: "active", lastRunStatus: "running", lastSuccessAt: "2026-09-28T17:00:00Z" }),
      "running",
    ],
    [summary({ status: "active", lastRunStatus: "queued" }), "running"],
    [summary({ status: "active", lastRunStatus: "failed", lastSuccessAt: "2026-09-27T17:00:00Z" }), "synced"],
    [summary({ status: "pending_approval" }), "awaitingApproval"],
    [summary({ status: "paused" }), "paused"],
    [summary({ status: "error" }), "needsAttention"],
    [summary({ status: "revoked" }), "revoked"],
  ] as const)("%j → %s", (input, state) => {
    expect(dataSourceState(input)).toBe(state);
  });
});

describe("dataSourceButton", () => {
  it("names the table and the state: Manual when nothing is connected", () => {
    expect(dataSourceButton(null, "patients", t, format, now)).toEqual({
      state: "Manual",
      ariaLabel: "Patients data source: Manual",
    });
  });

  it("includes the connection name and when it last synced", () => {
    const button = dataSourceButton(
      summary({ lastSuccessAt: "2026-09-28T17:55:00Z" }),
      "patients",
      t,
      format,
      now,
    );
    expect(button).toEqual({
      state: "Synced 5 minutes ago",
      ariaLabel: "Patients data source: Main EHR, Synced 5 minutes ago",
    });
  });

  it("uses words for every state, in the user's language", () => {
    const tes = createTranslator(es.shell, "es");
    expect(
      dataSourceButton(summary({ status: "error" }), "patients", tes, createFormatters("es"), now),
    ).toEqual({
      state: "Requiere atención",
      ariaLabel: "Origen de datos de Pacientes: Main EHR, Requiere atención",
    });
  });
});
