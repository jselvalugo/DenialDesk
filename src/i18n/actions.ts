"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getOperatorSession, getSession } from "@/auth/session";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { isLocale } from "./config";
import { setLocaleCookie } from "./cookie";

/**
 * The user menu's language choice (spec: internationalization, R-11.1). Sets the cookie for this
 * browser and, when the picker's realm (practice app or operator console) has a fully signed-in
 * session, stores the choice on that account so it follows them to their next sign-in on any
 * device. An unsupported value is ignored; a half-finished sign-in (no MFA yet) only gets the cookie.
 */
export async function setLocale(formData: FormData): Promise<void> {
  const locale = formData.get("locale");
  if (!isLocale(locale)) return;
  await setLocaleCookie(locale);
  const realm = formData.get("realm") === "operator" ? "operator" : "practice";
  const session = realm === "operator" ? await getOperatorSession() : await getSession();
  if (session?.mfaVerified) {
    await systemDb().update(users).set({ locale }).where(eq(users.id, session.userId));
  }
  revalidatePath("/", "layout");
}
