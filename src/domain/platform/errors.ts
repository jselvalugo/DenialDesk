import type { MessageKey } from "@/i18n/messages/types";
import type { Params } from "@/i18n/translate";

/**
 * A platform operator action that can't be completed. Carries an `operator` namespace message key
 * (and optional parameters) rather than English text, since domain code never imports `@/i18n/server`;
 * the caller (a server action) translates it with `t(error.key, error.params)`.
 */
export class PracticeError extends Error {
  constructor(
    readonly key: MessageKey<"operator">,
    readonly params?: Params,
  ) {
    super(key);
    this.name = "PracticeError";
  }
}
