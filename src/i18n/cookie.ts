import "server-only";
import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_S, type Locale } from "./config";

/**
 * Remembers the language in the browser: a two-letter code, readable by the server only. Not a
 * server action (this module has no "use server"), so it is never callable from the network;
 * the value is still checked, as defense in depth.
 */
export async function setLocaleCookie(locale: Locale): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_S,
  });
}
