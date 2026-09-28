import type { Messages } from "@/i18n/messages/types";
import { type Translator } from "@/i18n/translate";
import { CMS_SOURCE, OIR_SOURCE, SMMC_SOURCE } from "./florida-catalog";

type SettingsT = Translator<Messages["settings"]>;

/**
 * A payer's `source` column (payer-catalog P1) is internal provenance for the owner, never meant
 * for practice staff as-is — it carries a "⚠️ VERIFY" note (spec review, settings-and-custom-fields
 * S2 PR4) that would read as an alarming, untranslated warning if shown raw. This maps a known
 * catalog source to a translated "kind" label instead of rendering the stored string; any other
 * non-null source (a seeded practice, or one added a future payer admin screen writes) falls back
 * to a generic label, and a null source (today: only the synthetic seed's payers) reads as
 * "Not recorded" rather than a made-up "added by the practice" story.
 */
export function payerSourceLabel(source: string | null, t: SettingsT): string {
  if (source === null) return t("payers.sourceNotRecorded");
  if (source === OIR_SOURCE) return t("payers.sourceOir");
  if (source === SMMC_SOURCE) return t("payers.sourceSmmc");
  if (source === CMS_SOURCE) return t("payers.sourceCms");
  return t("payers.sourceReference");
}
