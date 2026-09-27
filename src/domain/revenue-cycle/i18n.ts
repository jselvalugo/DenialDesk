import { en } from "@/i18n/messages/en";
import type { MessageKey, Messages } from "@/i18n/messages/types";
import { createTranslator, formatNumber, type Translator } from "@/i18n/translate";
import type { CsvError, CsvErrorCode } from "@/lib/csv/parse";

/**
 * Translator for the `revenue` namespace. Pure domain modules take one of these instead of
 * importing `@/i18n/server` (spec: internationalization); server components, actions, and route
 * handlers pass the request's real translator from `getT("revenue")`.
 */
export type RevenueT = Translator<Messages["revenue"]>;

/**
 * English fallback: the default for functions whose translator parameter is optional, so a script
 * or a test that has no request-scoped language (seed.ts, unit tests) still gets readable text.
 */
export const englishRevenue: RevenueT = createTranslator(en.revenue, "en");

/** Message for each CSV parser problem (lib/csv/parse.ts), shown in the user's language. */
export const CSV_ERROR_KEYS: Record<CsvErrorCode, MessageKey<"revenue">> = {
  tooManyColumns: "csv.tooManyColumns",
  tooManyRows: "csv.tooManyRows",
  textAfterQuote: "csv.textAfterQuote",
  quoteInUnquotedField: "csv.quoteInUnquotedField",
  unclosedQuote: "csv.unclosedQuote",
};

/** The parser problem in the user's language, with its numbers in the language's digits (50,000 / 50.000). */
export function csvProblemMessage(error: CsvError, t: RevenueT): string {
  const params = Object.fromEntries(
    Object.entries(error.params).map(([k, v]) => [k, formatNumber(v, t.locale)]),
  );
  return t(CSV_ERROR_KEYS[error.code], params);
}
