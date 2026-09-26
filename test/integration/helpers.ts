import { randomUUID } from "node:crypto";
import { systemDb } from "@/db/client";
import { DatabaseError } from "@/db/errors";
import { memberships, tenants, users } from "@/db/schema";

/** Creates an isolated synthetic tenant with one admin user. */
export async function createTestTenant(label = "Test") {
  const suffix = randomUUID().slice(0, 8);
  const [tenant] = await systemDb()
    .insert(tenants)
    .values({ name: `${label} practice ${suffix} (synthetic)` })
    .returning();
  const [user] = await systemDb()
    .insert(users)
    .values({
      email: `admin-${suffix}@synthetic.test`,
      displayName: `Synthetic Admin ${suffix}`,
      passwordHash: "not-used",
    })
    .returning();
  await systemDb().insert(memberships).values({ tenantId: tenant!.id, userId: user!.id, role: "admin" });
  return { tenantId: tenant!.id, userId: user!.id };
}

/** Asserts a query fails with a sanitized database error whose message matches `pattern`. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await promise;
  } catch (error) {
    // Every query error is a DatabaseError without a cause (src/db/errors.ts).
    const message = (error as Error).message;
    if (error instanceof DatabaseError && pattern.test(message)) return;
    throw new Error(`Expected database error matching ${pattern}, got: ${(error as Error).name}: ${message}`);
  }
  throw new Error(`Expected database error matching ${pattern}, but the query succeeded`);
}
