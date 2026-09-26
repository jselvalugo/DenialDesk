// Seeds the synthetic demo practice. Usage: pnpm db:seed
// Env: DATABASE_URL, FIELD_ENCRYPTION_KEY, APP_ENV (never production),
//      SEED_ADMIN_EMAIL (default demo.admin@denialdesk.test), SEED_ADMIN_PASSWORD (generated if unset).
import { randomBytes } from "node:crypto";
import { closeDatabase } from "@/db/client";
import { DEMO_PRACTICE, seedDemoPractice } from "@/db/demo";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "demo.admin@denialdesk.test";
  const password = process.env.SEED_ADMIN_PASSWORD ?? randomBytes(12).toString("base64url");
  // Only repair (reset) the admin's password when one is configured explicitly.
  const result = await seedDemoPractice(
    { email, password },
    { repair: Boolean(process.env.SEED_ADMIN_PASSWORD) },
  );
  if (result === "exists") {
    process.stdout.write(`"${DEMO_PRACTICE}" already exists; set SEED_ADMIN_PASSWORD to reset its admin.\n`);
    return;
  }
  process.stdout.write(
    [
      result === "seeded"
        ? `Seeded "${DEMO_PRACTICE}".`
        : `"${DEMO_PRACTICE}" already exists; its admin password was reset and any lockout cleared.`,
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
