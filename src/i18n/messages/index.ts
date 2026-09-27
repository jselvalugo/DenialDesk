import type { Locale } from "../config";
import { en } from "./en";
import { es } from "./es";
import { pt } from "./pt";
import type { Messages } from "./types";

export type { MessageKey, Messages, Namespace } from "./types";

/** Every language's dictionary. English is the source; the others are checked against it by type and test. */
export const messages: Record<Locale, Messages> = { en, es, pt };
