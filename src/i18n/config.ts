/**
 * Supported user-interface languages (spec: docs/specs/internationalization.md, R-11.1). Pure
 * constants with no imports, so the seed script, tests, and client bundles can all use them.
 */
export const LOCALES = ["en", "es", "pt"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie carrying the chosen language. Holds a two-letter code only: never PHI, never a secret. */
export const LOCALE_COOKIE = "dd_locale";
export const LOCALE_COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/** Each language's name in itself, so a user who can't read the current language still finds theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  es: "Español",
  pt: "Português",
};

/**
 * BCP 47 tags for Intl formatting. Spanish and Portuguese as spoken by Florida practices: U.S.
 * Spanish and Brazilian Portuguese. Money is deliberately not localized (see lib/format.ts).
 */
export const INTL_TAGS: Record<Locale, string> = {
  en: "en-US",
  es: "es-US",
  pt: "pt-BR",
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Picks the best supported language from an `Accept-Language` header (RFC 9110 §12.5.4), used only
 * before a user has chosen one. Region subtags are ignored ("pt-BR" → "pt"); unknown languages are
 * skipped; no header or no match gives the default.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2);
      const quality = q === undefined ? 1 : Number(q);
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((entry) => entry.tag && entry.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of ranked) {
    const language = tag.split("-")[0];
    if (isLocale(language)) return language;
  }
  return DEFAULT_LOCALE;
}
