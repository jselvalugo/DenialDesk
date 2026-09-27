"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getOperatorSession, getSession } from "@/auth/session";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { isLocale, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_S, type Locale } from "./config";

/** Remembers the language in the browser: a two-letter code, readable by the server only. */
export async function setLocaleCookie(locale: Locale): Promise<void> {
  (await cookies()).set(LOCALE_COOKIE, locale, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_S,
  });
}

/**
 * The user menu's language choice (spec: internationalization, R-11.1). Sets the cookie for this
 * browser and, when someone is signed in (practice or operator), stores the choice on their account
 * so it follows them to their next sign-in on any device. An unsupported value is ignored.
 */
export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (!isLocale(locale)) return;
  await setLocaleCookie(locale);
  const session = (await getSession()) ?? (await getOperatorSession());
  if (session) {
    await systemDb().update(users).set({ locale }).where(eq(users.id, session.userId));
  }
  revalidatePath("/", "layout");
}
