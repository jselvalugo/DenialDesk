import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, negotiateLocale, type Locale } from "./config";
import { createFormatters, type Formatters } from "./format";
import { messages, type Messages, type Namespace } from "./messages";
import { createTranslator, type Translator } from "./translate";

/**
 * The request's language: the chosen one (cookie, set by the user menu or at sign-in from the
 * account's preference), else the browser's Accept-Language, else English. Once per request.
 */
export const getLocale = cache(async (): Promise<Locale> => {
  const chosen = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  try {
    return negotiateLocale((await headers()).get("accept-language"));
  } catch {
    return DEFAULT_LOCALE;
  }
});

/** The whole dictionary for the request's language; the root layout hands it to client components. */
export async function getMessages(): Promise<{ locale: Locale; messages: Messages }> {
  const locale = await getLocale();
  return { locale, messages: messages[locale] };
}

/** `t` for one namespace in server components, server actions, and route handlers. */
export async function getT<N extends Namespace>(namespace: N): Promise<Translator<Messages[N]>> {
  const locale = await getLocale();
  return createTranslator(messages[locale][namespace], locale);
}

/** Locale-aware date, date-time, and number formatting for server components. */
export async function getFormat(): Promise<Formatters> {
  return createFormatters(await getLocale());
}
