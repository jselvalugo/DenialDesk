import { en } from "@/i18n/messages/en";
import type { Messages } from "@/i18n/messages/types";
import { createTranslator, type Translator } from "@/i18n/translate";

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
