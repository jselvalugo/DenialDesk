/**
 * Small-cell suppression policy for Insight standard reports (R-8.7, owner decision 2026-09-26).
 *
 * When a report row/cell's underlying claims include at least one claim for a patient carrying a
 * sensitive-category tag (`patients.sensitivityTags`, R-3.5.1/R-4.5.1) and the row's count is
 * small enough that the row could effectively identify that patient, the row's count and its
 * dollar amounts/rates are suppressed instead of shown.
 *
 * The threshold below is a product privacy policy, not a Florida statute, a legal deadline, or a
 * rate the florida-rules-engine owns — it never belongs in `rules/`. It is set here, in its own
 * small config module, and read by the domain layer (`suppression.ts`) rather than hard-coded in
 * any report query or calculation.
 *
 * Rationale for the default of 11: CMS's public-use-file cell-size suppression policy suppresses
 * cells representing fewer than 11 individuals. DenialDesk borrows that number as a reasonable
 * starting point for its own small-cell risk, not because CMS's rule applies to this product.
 * ⚠️ VERIFY with counsel before relying on 11 as the right number for DenialDesk's risk profile.
 */
import type { Messages } from "@/i18n/messages/types";
import type { Translator } from "@/i18n/translate";

export const SMALL_CELL_SUPPRESSION_THRESHOLD = 11;

/**
 * The exact marker text shown in place of a suppressed row's count/dollar/rate cells, in the
 * caller's language. `t` is the insight-namespace translator (server pages call `getT("insight")`;
 * tests build one with `createTranslator(en.insight, "en")`).
 */
export function suppressedLabel(t: Translator<Messages["insight"]>): string {
  return t("suppression.label", { threshold: SMALL_CELL_SUPPRESSION_THRESHOLD });
}
