import { mkdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { generateTotpSecret } from "@/auth/totp";
import { closeDatabase, systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { encryptField } from "@/lib/crypto/field";

// Seeds a fresh synthetic practice per run with known test credentials. Test-only.
import {
  E2E_OPERATOR_EMAIL,
  E2E_OPERATOR_PASSWORD,
  E2E_OPERATOR_PASSWORD_HASH,
} from "./operator-credentials";

export { E2E_OPERATOR_EMAIL };

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
          .values({
            email: E2E_OPERATOR_EMAIL,
            displayName: "Olive Operator",
            passwordHash: E2E_OPERATOR_PASSWORD_HASH,
          })
          .returning({ id: users.id })
      )[0]!.id;
  await systemDb()
    .update(users)
    .set({
      // Same hash the server is configured with, so its sync sees no rotation and keeps this enrollment.
      passwordHash: E2E_OPERATOR_PASSWORD_HASH,
      totpSecretEnc: encryptField(operatorSecret),
      mfaEnrolledAt: new Date(),
      totpLastStep: null,
      failedLoginCount: 0,
      lockedUntil: null,
    })
    .where(eq(users.id, operatorId));
  enrolled.operator = {
    email: E2E_OPERATOR_EMAIL,
    password: E2E_OPERATOR_PASSWORD,
    totpSecret: operatorSecret,
  };
  await closeDatabase();

  mkdirSync("test/e2e/.auth", { recursive: true });
  writeFileSync("test/e2e/.auth/users.json", JSON.stringify(enrolled, null, 2));
}
