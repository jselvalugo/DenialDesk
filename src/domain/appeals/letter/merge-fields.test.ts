import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MAX_LETTER_CHARS,
  MERGE_FIELD_KEYS,
  MISSING_VALUE,
  checkBody,
  fieldsUsed,
  hasUnresolvedPlaceholder,
  letterDigest,
  missingFields,
  renderLetter,
  type MergeValues,
} from "./merge-fields";
import { STARTER_TEMPLATES, starterTemplate } from "./starter-templates";
import { CATEGORY_ORDER } from "@/domain/carc";

// All values are synthetic.
function values(overrides: Partial<MergeValues> = {}): MergeValues {
  const base = Object.fromEntries(MERGE_FIELD_KEYS.map((key) => [key, `<${key}>`])) as MergeValues;
  return { ...base, ...overrides };
}

describe("checkBody (unknown merge fields are refused at save)", () => {
  it("accepts every allow-listed field, with or without inner spaces", () => {
    const body = MERGE_FIELD_KEYS.map((key, i) => (i % 2 ? `{{${key}}}` : `{{ ${key} }}`)).join("\n");
    expect(checkBody(body)).toEqual({ ok: true });
  });

  it("refuses an unknown field and names it", () => {
    expect(checkBody("Hello {{patient.ssn}}")).toEqual({
      ok: false,
      reason: "unknown",
      unknown: ["patient.ssn"],
    });
  });

  it("refuses names that only look like Object properties", () => {
    for (const name of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(checkBody(`{{${name}}}`)).toMatchObject({ ok: false, reason: "unknown" });
    }
  });

  it("is case sensitive", () => {
    expect(checkBody("{{Claim.Number}}")).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("caps and de-duplicates the unknown names it reports", () => {
    const body = ["a", "b", "c", "d", "e", "f", "a"].map((n) => `{{${n}}}`).join(" ");
    const result = checkBody(body);
    expect(result).toMatchObject({ ok: false, reason: "unknown" });
    if (!result.ok && result.reason === "unknown") expect(result.unknown).toEqual(["a", "b", "c", "d", "e"]);
  });

  it.each(["{{", "}}", "{{claim.number", "claim.number}}", "{{{claim.number}}", "{{claim.{{number}}}}"])(
    "refuses a malformed token: %s",
    (body) => {
      expect(checkBody(body).ok).toBe(false);
    },
  );

  it("refuses empty and over-long bodies", () => {
    expect(checkBody("   \n ")).toEqual({ ok: false, reason: "empty" });
    expect(checkBody("x".repeat(MAX_LETTER_CHARS + 1))).toEqual({ ok: false, reason: "too_long" });
    expect(checkBody("x".repeat(MAX_LETTER_CHARS))).toEqual({ ok: true });
  });
});

describe("renderLetter", () => {
  it("fills allow-listed fields", () => {
    const out = renderLetter(
      "Claim {{claim.number}} for {{ patient.fullName }}",
      values({
        "claim.number": "CLM-1",
        "patient.fullName": "Pat Synthetic",
      }),
    );
    expect(out).toBe("Claim CLM-1 for Pat Synthetic");
  });

  it("shows a visible marker for a missing value", () => {
    const v = values({ "patient.birthDate": null, "provider.npi": "" });
    expect(renderLetter("{{patient.birthDate}}|{{provider.npi}}", v)).toBe(
      `${MISSING_VALUE}|${MISSING_VALUE}`,
    );
    expect(missingFields("{{patient.birthDate}} {{claim.number}} {{provider.npi}}", v)).toEqual([
      "patient.birthDate",
      "provider.npi",
    ]);
  });

  it("does not expand a token that came from a value (single pass)", () => {
    const v = values({ "patient.fullName": "{{payer.name}}", "payer.name": "SHOULD NOT APPEAR" });
    expect(renderLetter("{{patient.fullName}}", v)).toBe("{{payer.name}}");
  });

  it("leaves an unknown token as written instead of guessing", () => {
    expect(renderLetter("{{nope}} {{constructor}}", values())).toBe("{{nope}} {{constructor}}");
  });

  it("returns plain text; the page escapes it as a React text node (no HTML from rendering)", () => {
    const hostile = values({ "patient.fullName": '<script>alert("x")</script> & <img src=x onerror=1>' });
    const text = renderLetter("Dear {{patient.fullName}} <b>bold</b>", hostile);
    const html = renderToStaticMarkup(createElement("pre", null, text));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });
});

describe("fieldsUsed", () => {
  it("lists distinct allow-listed fields in order of first use", () => {
    expect(fieldsUsed("{{claim.number}} {{payer.name}} {{claim.number}} {{bogus}}")).toEqual([
      "claim.number",
      "payer.name",
    ]);
  });
});

describe("unresolved placeholders block attestation", () => {
  it.each(["[⚠️ VERIFY: cite the policy]", "VERIFY this", "[FILL IN: documents]"])("%s", (text) => {
    expect(hasUnresolvedPlaceholder(`Dear payer, ${text}`)).toBe(true);
  });

  it("passes a finished letter", () => {
    expect(hasUnresolvedPlaceholder("Dear payer, please review claim {{claim.number}}.")).toBe(false);
  });
});

describe("letterDigest", () => {
  it("is a stable SHA-256 hex string that changes with any character", () => {
    expect(letterDigest("a")).toMatch(/^[0-9a-f]{64}$/);
    expect(letterDigest("a")).toBe(letterDigest("a"));
    expect(letterDigest("a")).not.toBe(letterDigest("a "));
  });
});

describe("starter templates", () => {
  const all = [...new Set([...Object.values(STARTER_TEMPLATES), ...CATEGORY_ORDER.map(starterTemplate)])];

  it("cover the small starter set and fall back to the generic one", () => {
    expect(Object.keys(STARTER_TEMPLATES).sort()).toEqual(
      ["authorization", "coding", "eligibility", "medical_necessity", "other", "timely_filing"].sort(),
    );
    expect(starterTemplate("duplicate")).toBe(STARTER_TEMPLATES.other);
    expect(starterTemplate("medical_necessity")).toBe(STARTER_TEMPLATES.medical_necessity);
  });

  it.each(all.map((body, i) => [i, body] as const))(
    "starter %i uses only allow-listed fields",
    (_i, body) => {
      expect(checkBody(body)).toEqual({ ok: true });
    },
  );

  it.each(all.map((body, i) => [i, body] as const))(
    "starter %i keeps a visible citation placeholder and cannot be attested as is",
    (_i, body) => {
      expect(body).toContain("⚠️ VERIFY");
      expect(hasUnresolvedPlaceholder(body)).toBe(true);
    },
  );

  it.each(all.map((body, i) => [i, body] as const))(
    "starter %i cites no statute, rule number, or policy",
    (_i, body) => {
      expect(body).not.toMatch(/§|Fla\.? ?Stat|\bCFR\b|\bU\.?S\.?C\b|\b\d+\s*days\b/i);
    },
  );
});
