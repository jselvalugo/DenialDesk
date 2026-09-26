import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { generateTotpSecret } from "@/auth/totp";
import { closeDatabase, systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { hashPassword } from "@/auth/password";
import { seedPractice } from "@/db/seed";
import { encryptField } from "@/lib/crypto/field";

// Seeds a fresh synthetic practice per run with known test credentials. Test-only.
/**
 * Fixed so the test servers can name it in PLATFORM_OPERATOR_EMAIL (playwright.config.ts). The
 * operator belongs to no practice (docs/specs/operator-login.md).
 */
export const E2E_OPERATOR_EMAIL = "platform-operator@e2e.denialdesk.test";

export interface E2EUser {
  email: string;
  password: string;
  totpSecret: string | null;
}

export default async function globalSetup() {
  process.env.APP_ENV ||= "development";
  const run = randomBytes(4).toString("hex");
  const password = `e2e-synthetic-${run}`;
  const make = (name: string) => `${name}-${run}@e2e.denialdesk.test`;

  const { userIds } = await seedPractice({
    practiceName: `E2E practice ${run} (synthetic)`,
    asOf: todayIn(),
    users: [
      { email: make("worker"), displayName: "Riley Worker", role: "specialist", password },
      { email: make("viewer"), displayName: "Quinn Viewer", role: "compliance", password },
      { email: make("newbie"), displayName: "Sage Newbie", role: "specialist", password },
      { email: make("locked"), displayName: "Casey Locked", role: "specialist", password },
      { email: make("guesser"), displayName: "Parker Guesser", role: "specialist", password },
    ],
  });

  const enrolled: Record<string, E2EUser> = {};
  for (const [index, key] of ["worker", "viewer", "newbie", "locked", "guesser"].entries()) {
    const secret = key === "newbie" ? null : generateTotpSecret();
    if (secret) {
      await systemDb()
        .update(users)
        .set({ totpSecretEnc: encryptField(secret), mfaEnrolledAt: new Date() })
        .where(eq(users.id, userIds[index]!));
    }
    enrolled[key] = { email: make(key), password, totpSecret: secret };
  }
  // The platform operator: one fixed account, reused across runs with fresh credentials.
  const operatorSecret = generateTotpSecret();
  const [operator] = await systemDb().select().from(users).where(eq(users.email, E2E_OPERATOR_EMAIL));
  const operatorId = operator
    ? operator.id
    : (
        await systemDb()
          .insert(users)
          .values({ email: E2E_OPERATOR_EMAIL, displayName: "Olive Operator", passwordHash: "unset" })
          .returning({ id: users.id })
      )[0]!.id;
  await systemDb()
    .update(users)
    .set({
      passwordHash: await hashPassword(password),
      totpSecretEnc: encryptField(operatorSecret),
      mfaEnrolledAt: new Date(),
      totpLastStep: null,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, operatorId));
  enrolled.operator = { email: E2E_OPERATOR_EMAIL, password, totpSecret: operatorSecret };
  await closeDatabase();

  mkdirSync("test/e2e/.auth", { recursive: true });
  writeFileSync("test/e2e/.auth/users.json", JSON.stringify(enrolled, null, 2));
}
