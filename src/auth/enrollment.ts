import "server-only";
import { eq } from "drizzle-orm";
import { systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { decryptField, encryptField } from "@/lib/crypto/field";
import { getSession } from "./session";
import { generateTotpSecret } from "./totp";

/**
 * Returns the pending TOTP secret for a signed-in-by-password user who hasn't enrolled yet,
 * creating one if needed. Only callable in that state.
 */
export async function pendingEnrollmentSecret(): Promise<{ secret: string; email: string } | null> {
  const session = await getSession();
  if (!session || session.mfaVerified || session.mfaEnrolled) return null;
  const [user] = await systemDb().select().from(users).where(eq(users.id, session.userId)).limit(1);
  if (!user) return null;
  if (user.totpSecretEnc) return { secret: decryptField(user.totpSecretEnc), email: user.email };
  const secret = generateTotpSecret();
  await systemDb()
    .update(users)
    .set({ totpSecretEnc: encryptField(secret) })
    .where(eq(users.id, user.id));
  return { secret, email: user.email };
}
