// Seeds one synthetic demo practice. Usage: pnpm db:seed
// Env: DATABASE_URL, FIELD_ENCRYPTION_KEY, APP_ENV (never production),
//      SEED_ADMIN_EMAIL (default demo.admin@denialdesk.test), SEED_ADMIN_PASSWORD (generated if unset).
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { closeDatabase, systemDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { seedPractice } from "@/db/seed";

const PRACTICE = "Coral Bay Physicians (synthetic)";

async function main() {
  const existing = await systemDb().select().from(tenants).where(eq(tenants.name, PRACTICE)).limit(1);
  if (existing.length > 0) {
    process.stdout.write(`"${PRACTICE}" already exists; nothing to do.\n`);
    return;
  }
  const email = process.env.SEED_ADMIN_EMAIL ?? "demo.admin@denialdesk.test";
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
  const { tenantId } = await seedPractice({
    practiceName: PRACTICE,
    asOf: todayIn(),
    users: [
      { email, displayName: "Morgan Delacroix", role: "admin", password },
      { email: "m.alvarez@denialdesk.test", displayName: "Marisol Alvarez", role: "specialist" },
      { email: "j.chen@denialdesk.test", displayName: "Jonah Chen", role: "specialist" },
      { email: "t.okafor@denialdesk.test", displayName: "Tobi Okafor", role: "manager" },
    ],
  });
  process.stdout.write(
    [
      `Seeded "${PRACTICE}" (tenant ${tenantId}).`,
      `Sign in as ${email}`,
      process.env.SEED_ADMIN_PASSWORD
        ? "Password: from SEED_ADMIN_PASSWORD"
        : `Password: ${password}   (shown once; synthetic demo account)`,
      "You'll set up two-step verification with an authenticator app on first sign-in.",
      "",
    ].join("\n"),
  );
}

main()
  .catch((error: unknown) => {
    process.stderr.write(`Seed failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
