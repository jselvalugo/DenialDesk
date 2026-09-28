import { describe, expect, it } from "vitest";
import type { DataSourceSummary } from "@/domain/integrations/connections";
import { createFormatters } from "@/i18n/format";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { pt } from "@/i18n/messages/pt";
import { createTranslator } from "@/i18n/translate";
import { dataSourceAdminLink, dataSourceButton, dataSourceState, summaryForRole } from "./data-source";

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
    [summary({ status: "active", lastRunStatus: "failed" }), "notSynced"],
    [summary({ status: "paused", lastRunStatus: "running" }), "paused"],
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
      ariaLabel: "Origen: Main EHR, Requiere atención (datos de Pacientes)",
    });
  });
});

/** Lowercase words only, so "Source: Main EHR · Synced" and "source: Main EHR, Synced" compare equal. */
const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

describe("label in name (WCAG 2.5.3): the accessible name contains the visible text", () => {
  const locales = [
    ["en", en.shell],
    ["es", es.shell],
    ["pt", pt.shell],
  ] as const;
  for (const [locale, messages] of locales) {
    it.each([
      null,
      summary({ lastSuccessAt: "2026-09-28T17:55:00Z" }),
      summary({ status: "error" }),
      summary({ status: "revoked" }),
    ])(`${locale}: %j`, (input) => {
      const tl = createTranslator(messages, locale);
      const { state, ariaLabel } = dataSourceButton(input, "patients", tl, createFormatters(locale), now);
      const visible = [tl("dataSource.source"), input?.displayName, state].filter(Boolean).join(" ");
      expect(words(ariaLabel)).toContain(words(visible));
    });
  }
});

describe("dataSourceAdminLink", () => {
  it("offers nothing to other roles", () => {
    expect(dataSourceAdminLink(summary(), false)).toBeNull();
    expect(dataSourceAdminLink(null, false)).toBeNull();
  });

  it("sends administrators to connect when nothing is a source or the last one was revoked", () => {
    expect(dataSourceAdminLink(null, true)).toEqual({ kind: "connect", href: "/settings/integrations" });
    expect(dataSourceAdminLink(summary({ status: "revoked" }), true)).toEqual({
      kind: "connect",
      href: "/settings/integrations",
    });
  });

  it("sends administrators to the live connection's page", () => {
    expect(dataSourceAdminLink(summary({ status: "active" }), true)).toEqual({
      kind: "settings",
      href: "/settings/integrations/00000000-0000-4000-8000-000000000001",
    });
  });
});

describe("summaryForRole (minimum necessary)", () => {
  it("strips the connection id for every role but administrators", () => {
    expect(summaryForRole(summary(), false)).toEqual({ ...summary(), connectionId: null });
    expect(summaryForRole(summary(), true)).toEqual(summary());
    expect(summaryForRole(null, false)).toBeNull();
  });
});
