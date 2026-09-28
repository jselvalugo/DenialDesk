import { beforeEach, describe, expect, it, vi } from "vitest";

// docs/specs/settings-and-custom-fields.md S2 PR4: only administrators and managers may change a
// payer's custom field values (`canEditPayerFields`). This is checked before `withTenant`/the
// database is ever touched, so the forbidden path needs no DB mock — only `requireAuth` and the
// `next/headers` shape `getT` reads outside a real request (route.test.ts's pattern).

const requireAuth = vi.fn();
vi.mock("@/auth/session", () => ({ requireAuth: () => requireAuth() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

const { savePayerCustomFields } = await import("./actions");

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

function form() {
  const data = new FormData();
  data.set("payerId", "33333333-3333-4333-8333-333333333333");
  data.set("expectedValuesToken", "0:");
  return data;
}

describe("savePayerCustomFields (role gate: canEditPayerFields)", () => {
  beforeEach(() => requireAuth.mockClear());

  it.each(["specialist", "compliance"])("refuses a %s with no database access", async (role) => {
    requireAuth.mockResolvedValue(auth(role));
    const result = await savePayerCustomFields({}, form());
    expect(result.error).toBe("Only administrators and managers can change a payer's custom fields.");
  });
});
