import { eq } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { systemDb } from "./client";
import { tenants } from "./schema";
import { seedPractice } from "./seed";

export const DEMO_PRACTICE = "Coral Bay Physicians (synthetic)";

/**
 * Creates the synthetic demo practice once. Returns "exists" if it's already there, so repeated
 * calls are harmless. Used by `pnpm db:seed` and the pre-production seed endpoint.
 */
export async function seedDemoPractice(admin: {
  email: string;
  password: string;
}): Promise<"seeded" | "exists"> {
  const existing = await systemDb()
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.name, DEMO_PRACTICE))
    .limit(1);
  if (existing.length > 0) return "exists";
  await seedPractice({
    practiceName: DEMO_PRACTICE,
    asOf: todayIn(),
    users: [
      { email: admin.email, displayName: "Morgan Delacroix", role: "admin", password: admin.password },
      { email: "m.alvarez@denialdesk.test", displayName: "Marisol Alvarez", role: "specialist" },
      { email: "j.chen@denialdesk.test", displayName: "Jonah Chen", role: "specialist" },
      { email: "t.okafor@denialdesk.test", displayName: "Tobi Okafor", role: "manager" },
    ],
  });
  return "seeded";
}
