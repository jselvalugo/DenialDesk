import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { SESSION_COOKIE } from "@/auth/policy";
import { closeDatabase, systemDb } from "@/db/client";
import { auditEvents, sessions, tenants } from "@/db/schema";
import { createTestTenant } from "./helpers";

// The one-click demo was removed (2026-09-26). A leftover demo session must never work again:
// requireAuth ends it (audited), and no code path can create one. Real session code against the
// database; only cookies, headers and redirect are faked.

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: vi.fn(),
    delete: vi.fn(),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));

const { createSession, requireAuth } = await import("@/auth/session");

beforeEach(() => jar.clear());
afterAll(() => closeDatabase());

describe("leftover demo sessions", () => {
  it("are ended on sight and the end is audited", async () => {
    const practice = await createTestTenant("Legacy demo practice (synthetic)");
    await systemDb()
      .update(tenants)
      .set({ kind: "demo", suspendedAt: new Date() }) // every demo practice is archived now
      .where(eq(tenants.id, practice.tenantId));
    const token = randomBytes(32).toString("base64url");
    const [row] = await systemDb()
      .insert(sessions)
      .values({
        tokenHash: createHash("sha256").update(token).digest("hex"),
        userId: practice.userId,
        tenantId: practice.tenantId,
        mfaVerified: true,
        authMethod: "demo",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: sessions.id });
    jar.set(SESSION_COOKIE, token);

    await expect(requireAuth()).rejects.toThrow("redirect:/login");
    const [after] = await systemDb().select().from(sessions).where(eq(sessions.id, row!.id));
    expect(after!.revokedAt).not.toBeNull();
    const [event] = await systemDb()
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.action, "auth.session_revoked"), eq(auditEvents.entityId, row!.id)));
    expect(event?.metadata).toEqual({ reason: "demo_retired" });
  });

  it("can't be created by any code path", async () => {
    const practice = await createTestTenant("Practice (synthetic)");
    await expect(
      createSession(practice.userId, { authMethod: "demo", tenantId: practice.tenantId }),
    ).rejects.toThrow(/no longer exist/);
  });
});
