import { describe, expect, it } from "vitest";
import type { Issue837, Issue837Code } from "@/edi/x12/837p";
import { messages } from "@/i18n/messages";
import { createTranslator } from "@/i18n/translate";
import { LOCALES } from "@/i18n/config";
import { FIELD_KEYS, ISSUE_KEYS, issueMessage } from "./edi-837p-messages";

// docs/specs/claims.md C3a: every refusal is a fixed sentence in all three languages, with no value in it.

const CODES = Object.keys(ISSUE_KEYS) as Issue837Code[];

describe("837P refusal sentences", () => {
  it.each(LOCALES)("has a sentence for every refusal code in %s, with nothing left unfilled", (locale) => {
    const t = createTranslator(messages[locale].claims, locale);
    for (const code of CODES) {
      const issue: Issue837 = {
        code,
        line: 3,
        field: code === "invalid_character" ? "subscriber_last_name" : undefined,
      };
      const text = issueMessage(issue, t);
      expect(text.trim(), `${locale}.${code}`).not.toBe("");
      expect(text, `${locale}.${code}`).not.toMatch(/[{}]/);
      expect(text, `${locale}.${code}`).not.toBe(ISSUE_KEYS[code]);
    }
  });

  it("names the line where a refusal concerns one, and the field for a character problem", () => {
    const t = createTranslator(messages.en.claims, "en");
    expect(issueMessage({ code: "diagnosis_pointers_required", line: 2 }, t)).toBe(
      "Line 2: choose which diagnoses support this line.",
    );
    expect(issueMessage({ code: "invalid_character", field: "subscriber_last_name" }, t)).toContain(
      "patient's last name",
    );
    expect(issueMessage({ code: "lines_too_many" }, t)).toContain("50");
    expect(issueMessage({ code: "line_invalid" }, t)).toBe("The service lines have a repeated line number.");
  });

  it("has a label for every field the generator can name", () => {
    for (const key of Object.values(FIELD_KEYS)) {
      for (const locale of LOCALES) {
        const table = messages[locale].claims as Record<string, string>;
        expect(table[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });
});
