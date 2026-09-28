import { describe, expect, it } from "vitest";
import type { PatientsConnectionSummary } from "@/domain/integrations/connections";
import { es } from "@/i18n/messages/es";
import { pt } from "@/i18n/messages/pt";
import { createTranslator } from "@/i18n/translate";
import { canOfferNewConnection, dataSourceState } from "./data-source";

const now = new Date("2026-09-28T12:00:00Z");

function summary(overrides: Partial<PatientsConnectionSummary> = {}): PatientsConnectionSummary {
  return {
    id: "c1",
    displayName: "Acme EHR",
    status: "active",
    isSandbox: false,
    lastSuccessAt: null,
    hasSynced: false,
    ...overrides,
  };
}

describe("dataSourceState", () => {
  it("reads as Manual with no connection", () => {
    const state = dataSourceState(null, now);
    expect(state.label).toBe("Source: Manual");
    expect(state.accessibleName).toBe("Patients data source: Manual");
    expect(state.tone).toBe("neutral");
  });

  it("reads as Manual for a draft connection", () => {
    const state = dataSourceState(summary({ status: "draft" }), now);
    expect(state.label).toBe("Source: Manual");
  });

  it("reads as Awaiting approval for a pending connection", () => {
    const state = dataSourceState(summary({ status: "pending_approval" }), now);
    expect(state.label).toBe("Source: Acme EHR · Awaiting approval");
    expect(state.tone).toBe("info");
  });

  it("reads as not yet synced for an active connection with no successful run", () => {
    const state = dataSourceState(summary({ status: "active", lastSuccessAt: null }), now);
    expect(state.label).toBe("Source: Acme EHR · Not yet synced");
    expect(state.tone).toBe("success");
  });

  it("shows a relative sync time once one exists", () => {
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000);
    const state = dataSourceState(summary({ status: "active", lastSuccessAt: fiveMinutesAgo }), now);
    expect(state.label).toBe("Source: Acme EHR · Synced 5 minutes ago");
  });

  it("rounds to hours and days for older syncs", () => {
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60_000);
    expect(dataSourceState(summary({ lastSuccessAt: twoHoursAgo }), now).label).toBe(
      "Source: Acme EHR · Synced 2 hours ago",
    );
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60_000);
    expect(dataSourceState(summary({ lastSuccessAt: threeDaysAgo }), now).label).toBe(
      "Source: Acme EHR · Synced 3 days ago",
    );
  });

  it("reads as Paused / Needs attention / Revoked", () => {
    expect(dataSourceState(summary({ status: "paused" }), now).label).toBe("Source: Acme EHR · Paused");
    expect(dataSourceState(summary({ status: "paused" }), now).tone).toBe("warning");
    expect(dataSourceState(summary({ status: "error" }), now).label).toBe(
      "Source: Acme EHR · Needs attention",
    );
    expect(dataSourceState(summary({ status: "error" }), now).tone).toBe("danger");
    expect(dataSourceState(summary({ status: "revoked" }), now).label).toBe("Source: Acme EHR · Revoked");
  });
});

describe("dataSourceState translates (security review PR #81: the menu was hard-coded to English)", () => {
  it("reads in Spanish when given the Spanish translator", () => {
    const t = createTranslator(es.shell, "es");
    const state = dataSourceState(summary({ status: "paused" }), now, t);
    expect(state.label).toBe("Origen: Acme EHR · Pausado");
    expect(state.accessibleName).toBe("Origen de datos de pacientes: Pausado");
  });

  it("reads in Portuguese when given the Portuguese translator", () => {
    const t = createTranslator(pt.shell, "pt");
    const state = dataSourceState(null, now, t);
    expect(state.label).toBe("Origem: Manual");
  });
});

describe("canOfferNewConnection", () => {
  it("is true with no connection or a revoked one", () => {
    expect(canOfferNewConnection(null)).toBe(true);
    expect(canOfferNewConnection(summary({ status: "revoked" }))).toBe(true);
  });

  it("is false for every other status, including draft", () => {
    expect(canOfferNewConnection(summary({ status: "draft" }))).toBe(false);
    expect(canOfferNewConnection(summary({ status: "active" }))).toBe(false);
    expect(canOfferNewConnection(summary({ status: "pending_approval" }))).toBe(false);
  });
});
