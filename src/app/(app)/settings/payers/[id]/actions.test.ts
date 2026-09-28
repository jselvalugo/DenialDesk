import { beforeEach, describe, expect, it, vi } from "vitest";

// docs/specs/settings-and-custom-fields.md S2 PR4: revealing a locked payer custom field value
// uses the same minimum-necessary roles as revealing a member ID (`canWorkDenials`); a compliance
// user is refused before the database is ever touched.

const requireAuth = vi.fn();
vi.mock("@/auth/session", () => ({ requireAuth: () => requireAuth() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

const { revealPayerCustomField } = await import("./actions");

const auth = (role: string) => ({
  sessionId: "s1",
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  displayName: "Test User",
  tenantName: "Synthetic Practice (synthetic)",
  role,
  tenantKind: "customer",
  authMethod: "password",
  email: "test@synthetic.test",
});

describe("revealPayerCustomField (role gate: canWorkDenials)", () => {
  beforeEach(() => requireAuth.mockClear());

  it("refuses a compliance user with no database access", async () => {
    requireAuth.mockResolvedValue(auth("compliance"));
    const result = await revealPayerCustomField(
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
      "other",
    );
    expect(result.error).toBe("You don't have permission to view this field.");
    expect(result.value).toBeUndefined();
  });
});
