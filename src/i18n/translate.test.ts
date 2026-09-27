import { describe, expect, it } from "vitest";
import { createTranslator, formatMessage, formatNumber } from "./translate";

describe("formatMessage", () => {
  it("inserts parameters and leaves missing ones visible", () => {
    expect(formatMessage("Hello, {name}", { name: "Ana" })).toBe("Hello, Ana");
    expect(formatMessage("Hello, {name}")).toBe("Hello, {name}");
    expect(formatMessage("Page {page} of {pages}", { page: 2, pages: 10 })).toBe("Page 2 of 10");
  });

  it("chooses plural branches per locale and formats # for the locale", () => {
    const en = "{count, plural, =0 {No denials} one {# denial} other {# denials}}";
    expect(formatMessage(en, { count: 0 })).toBe("No denials");
    expect(formatMessage(en, { count: 1 })).toBe("1 denial");
    expect(formatMessage(en, { count: 1234 })).toBe("1,234 denials");
    const pt = "{count, plural, one {# dia} other {# dias}}";
    expect(formatMessage(pt, { count: 1 }, "pt")).toBe("1 dia");
    expect(formatMessage(pt, { count: 1234 }, "pt")).toBe("1.234 dias");
  });

  it("allows parameters inside plural branches and text around them", () => {
    const message = "Showing {count, plural, one {# result} other {# results}} for {who}";
    expect(formatMessage(message, { count: 3, who: "you" })).toBe("Showing 3 results for you");
  });

  it("tolerates unbalanced braces without throwing", () => {
    expect(formatMessage("oops {name", { name: "x" })).toBe("oops {name");
    expect(formatMessage("{n, plural, one {x}}", { n: 5 })).toBe("{n, plural, one {x}}");
  });
});

describe("createTranslator", () => {
  const t = createTranslator({ greeting: "Hola, {name}", plain: "Texto" }, "es");
  it("formats by key and reports its locale", () => {
    expect(t("greeting", { name: "Luis" })).toBe("Hola, Luis");
    expect(t("plain")).toBe("Texto");
    expect(t.locale).toBe("es");
    expect(t.raw("greeting")).toBe("Hola, {name}");
  });
  it("returns the key for an unknown key instead of blank text", () => {
    expect((t as unknown as (k: string) => string)("missing.key")).toBe("missing.key");
  });
});

describe("formatNumber", () => {
  it("groups digits per locale", () => {
    expect(formatNumber(1234567, "en")).toBe("1,234,567");
    expect(formatNumber(1234567, "es")).toBe("1,234,567");
    expect(formatNumber(1234567, "pt")).toBe("1.234.567");
  });
});
