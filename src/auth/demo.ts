import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { todayIn } from "@rules/calendar";
import { systemDb } from "@/db/client";
import { memberships, tenants, users } from "@/db/schema";
import { seedPractice } from "@/db/seed";
import { demoLoginEnabled } from "@/lib/env";

// The one-click demo (spec: docs/specs/demo-login-and-operator-console.md). A dedicated demo
// practice with synthetic data, created on first use. Only its "guest" user can be signed into
// through the demo path; that user belongs to no other practice.

const DEMO_NAME = "Sunrise Coast Medical Group (demo)";
const GUEST_EMAIL_PREFIX = "guest-";
const GUEST_EMAIL_DOMAIN = "@demo.denialdesk.test";

export function isDemoGuestEmail(email: string): boolean {
  return (
    email.toLowerCase().startsWith(GUEST_EMAIL_PREFIX) && email.toLowerCase().endsWith(GUEST_EMAIL_DOMAIN)
  );
}

async function findDemoGuest(): Promise<{ tenantId: string; userId: string } | null> {
  const [row] = await systemDb()
    .select({ tenantId: tenants.id, userId: users.id })
    .from(tenants)
    .innerJoin(memberships, eq(memberships.tenantId, tenants.id))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(
      and(
        eq(tenants.kind, "demo"),
        isNull(tenants.suspendedAt),
        like(users.email, `${GUEST_EMAIL_PREFIX}%${GUEST_EMAIL_DOMAIN}`),
      ),
    )
    .orderBy(desc(tenants.createdAt))
    .limit(1);
  return row ?? null;
}

/** Creates a fresh demo practice with synthetic data and returns its guest user. */
export async function createDemoPractice(): Promise<{ tenantId: string; userId: string }> {
  if (!demoLoginEnabled()) throw new Error("The demo practice is disabled in this environment");
  const suffix = randomBytes(4).toString("hex");
  const { tenantId, userIds } = await seedPractice({
    practiceName: DEMO_NAME,
    kind: "demo",
    asOf: todayIn(),
    users: [
      // No usable password: the guest can only sign in through the demo button.
      {
        email: `${GUEST_EMAIL_PREFIX}${suffix}${GUEST_EMAIL_DOMAIN}`,
        displayName: "Demo Guest",
        role: "manager",
      },
      {
        email: `r.lindqvist-${suffix}@demo.denialdesk.test`,
        displayName: "Rowan Lindqvist",
        role: "specialist",
      },
      { email: `h.ashby-${suffix}@demo.denialdesk.test`, displayName: "Harper Ashby", role: "specialist" },
    ],
  });
  return { tenantId, userId: userIds[0]! };
}

const isUniqueViolation = (error: unknown) =>
  (error as { cause?: { code?: string } })?.cause?.code === "23505" ||
  (error as { code?: string })?.code === "23505";

/**
 * The current demo practice's guest, creating the practice on first use. A unique index allows
 * one active demo practice, so if two first clicks race, the loser waits for the winner's.
 */
export async function ensureDemoPractice(): Promise<{ tenantId: string; userId: string }> {
  const existing = await findDemoGuest();
  if (existing) return existing;
  try {
    return await createDemoPractice();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    for (let attempt = 0; attempt < 40; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const created = await findDemoGuest();
      if (created) return created;
    }
    throw new Error("Timed out waiting for the demo practice to be created");
  }
}
