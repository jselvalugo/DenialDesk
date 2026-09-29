import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { pt } from "@/i18n/messages/pt";
import {
  isSyncIssueCode,
  isSyncRunCode,
  issueCodeLabelKey,
  runCodeLabelKey,
  runCodeLabelKeys,
  SYNC_CODE_OTHER_KEY,
  SYNC_ISSUE_CODES,
  SYNC_RUN_CODES,
} from "./sync-codes";

// docs/specs/patient-integrations.md PI2b "Sync history", threat model I1: a stored code reaches the
// page only through a fixed allow-list of translated labels.

const ALL = [...new Set([...SYNC_ISSUE_CODES, ...SYNC_RUN_CODES])];

describe("the sync code allow-lists", () => {
  it("every code fits the database's shape, so it can be stored, and no list repeats a code", () => {
    for (const code of ALL) expect(code).toMatch(/^[a-z_]{1,64}$/);
    expect(new Set(SYNC_ISSUE_CODES).size).toBe(SYNC_ISSUE_CODES.length);
    expect(new Set(SYNC_RUN_CODES).size).toBe(SYNC_RUN_CODES.length);
  });

  it("has no sensitivity, restriction, minor, or Part 2 code: a code linked to a patient row must be PHI-free", () => {
    const forbidden =
      /hiv|psy|behavior|mental|substance|sud|part2|42cfr|ethnic|race|sdv|violence|restrict|sensitiv|confidential|minor|child|pediatric|diagnos|program|aids|std|abortion|reproduct/;
    for (const code of ALL) expect(code, code).not.toMatch(forbidden);
    // The R/V confidentiality labels and the ActCode sensitivity codes never appear as codes either.
    for (const code of ["r", "v", "hiv", "psy", "eth", "sdv", "42cfrpart2"]) {
      expect(isSyncIssueCode(code)).toBe(false);
      expect(isSyncRunCode(code)).toBe(false);
    }
  });

  it("every listed code, and the generic one, has a label in English, Spanish, and Portuguese", () => {
    for (const [name, dictionary] of [
      ["en", en.integrations],
      ["es", es.integrations],
      ["pt", pt.integrations],
    ] as const) {
      const messages = dictionary as Record<string, string>;
      for (const code of ALL) {
        expect(messages[`runs.code.${code}`], `${name} runs.code.${code}`).toBeTruthy();
      }
      expect(messages[SYNC_CODE_OTHER_KEY]).toBeTruthy();
    }
  });

  it("no label echoes a raw code with an underscore: the page never shows the stored string", () => {
    for (const code of ALL.filter((entry) => entry.includes("_"))) {
      expect(en.integrations[`runs.code.${code}` as keyof typeof en.integrations]).not.toContain(code);
    }
  });
});

describe("mapping a stored code to its label", () => {
  it("a listed issue code reads as its own label", () => {
    expect(issueCodeLabelKey("mrn_missing")).toBe("runs.code.mrn_missing");
    expect(runCodeLabelKey("mrn_missing")).toBe("runs.code.mrn_missing");
    expect(runCodeLabelKey("issuer_mismatch")).toBe("runs.code.issuer_mismatch");
  });

  it("an issue row takes only issue codes: a run-level code there is 'other'", () => {
    expect(issueCodeLabelKey("issuer_mismatch")).toBe(SYNC_CODE_OTHER_KEY);
  });

  it.each([
    "",
    "hiv_positive_flag",
    "HIV",
    "mrn_missing ",
    "MRN_MISSING",
    "not-supported",
    "Jane Doe 1990-01-01",
    "constructor",
    "__proto__",
  ])("an unknown stored code %j is 'other', never itself", (code) => {
    expect(issueCodeLabelKey(code)).toBe(SYNC_CODE_OTHER_KEY);
    expect(runCodeLabelKey(code)).toBe(SYNC_CODE_OTHER_KEY);
    expect(isSyncIssueCode(code)).toBe(false);
    expect(isSyncRunCode(code)).toBe(false);
  });

  it("a run's codes become distinct labels with 'other' once, last", () => {
    expect(runCodeLabelKeys(["zz_a", "throttled", "zz_b", "mrn_missing", "throttled"])).toEqual([
      "runs.code.throttled",
      "runs.code.mrn_missing",
      SYNC_CODE_OTHER_KEY,
    ]);
    expect(runCodeLabelKeys([])).toEqual([]);
  });

  it("the type guards refuse non-strings", () => {
    for (const value of [null, undefined, 42, {}, ["mrn_missing"]]) {
      expect(isSyncIssueCode(value)).toBe(false);
      expect(isSyncRunCode(value)).toBe(false);
    }
  });
});
