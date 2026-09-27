import type { MessageKey } from "@/i18n/messages/types";
import type { Params } from "@/i18n/translate";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";

/**
 * A platform operator action that can't be completed. Carries an `operator` namespace message key
 * (and optional parameters) rather than English text, since domain code never imports `@/i18n/server`;
 * the caller (a server action) translates it with `t(error.key, error.params)`.
 */
const english = createTranslator(en.operator, "en");
function englishMessage(key: MessageKey<"operator">, params?: Params): string {
  return english(key, params);
}

export class PracticeError extends Error {
  constructor(
    public readonly key: MessageKey<"operator">,
    public readonly params?: Params,
  ) {
    // The message is the English text, so logs and tests read it directly; server actions translate
    // `key`/`params` for the user instead of showing `message`.
    super(englishMessage(key, params));
    this.name = "PracticeError";
  }
}
