import { beforeEach, describe, expect, it, vi } from "vitest";

// getLocale reads next/headers, which only works inside a request; the request is simulated here.
let cookieValue: string | undefined;
let acceptLanguage: string | null;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "dd_locale" && cookieValue ? { value: cookieValue } : undefined),
  }),
  headers: async () => ({ get: (name: string) => (name === "accept-language" ? acceptLanguage : null) }),
}));
// React's cache() memoizes per request; outside React it runs the function each time.
const { getFormat, getLocale, getT } = await import("./server");

describe("getLocale (spec: internationalization)", () => {
  beforeEach(() => {
    cookieValue = undefined;
    acceptLanguage = null;
  });

  it("prefers the chosen language over the browser's", async () => {
    cookieValue = "pt";
    acceptLanguage = "es-419,es;q=0.9";
    expect(await getLocale()).toBe("pt");
  });

  it("falls back to Accept-Language, then English", async () => {
    acceptLanguage = "es-419,es;q=0.9";
    expect(await getLocale()).toBe("es");
    acceptLanguage = null;
    expect(await getLocale()).toBe("en");
  });

  it("ignores a cookie with an unsupported value", async () => {
    cookieValue = "fr";
    acceptLanguage = "pt-BR";
    expect(await getLocale()).toBe("pt");
  });

  it("hands out a translator and formatters for the same language", async () => {
    cookieValue = "es";
    const t = await getT("shell");
    const f = await getFormat();
    expect(t.locale).toBe("es");
    expect(t("userMenu.language")).toBe("Idioma");
    expect(f.date("2026-12-31")).toBe("31/12/2026");
  });
});
