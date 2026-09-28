import { beforeEach, describe, expect, it, vi } from "vitest";

// docs/specs/patient-integrations.md "PI1b": every integration action is admin-only
// (`canManageIntegrations`), re-checked here on the server regardless of what the UI shows.
// The role gate is checked before any database access, so these are fast, DB-free unit tests
// (same pattern as settings/payers/[id]/actions.test.ts).

const requireAuth = vi.fn();
vi.mock("@/auth/session", () => ({
  requireAuth: () => requireAuth(),
  hasRecentMfa: () => true,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));
const withTenant = vi.fn();
vi.mock("@/db/tenant", () => ({ withTenant: (...args: unknown[]) => withTenant(...args) }));

const {
  createConnectionAction,
  updateConnectionAction,
  withdrawConnectionAction,
  pauseConnectionAction,
  resumeConnectionAction,
  revokeConnectionAction,
  activateSandboxAction,
} = await import("./actions");

const auth = (role: string) => ({
  sessionId: "s1",
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  displayName: "Test User",
  tenantName: "Synthetic Practice (synthetic)",
  role,
  tenantKind: "customer",
  authMethod: "password_mfa",
  email: "test@synthetic.test",
  mfaVerifiedAt: new Date(),
});

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("integration actions (role gate: canManageIntegrations)", () => {
  beforeEach(() => {
    requireAuth.mockClear();
    withTenant.mockClear();
  });

  it.each([
    ["createConnectionAction", createConnectionAction, {}],
    [
      "updateConnectionAction",
      updateConnectionAction,
      { connectionId: "33333333-3333-4333-8333-333333333333" },
    ],
    [
      "withdrawConnectionAction",
      withdrawConnectionAction,
      { connectionId: "33333333-3333-4333-8333-333333333333" },
    ],
    [
      "pauseConnectionAction",
      pauseConnectionAction,
      { connectionId: "33333333-3333-4333-8333-333333333333" },
    ],
    [
      "resumeConnectionAction",
      resumeConnectionAction,
      { connectionId: "33333333-3333-4333-8333-333333333333" },
    ],
    [
      "revokeConnectionAction",
      revokeConnectionAction,
      { connectionId: "33333333-3333-4333-8333-333333333333", reasonCode: "other" },
    ],
    [
      "activateSandboxAction",
      activateSandboxAction,
      { connectionId: "33333333-3333-4333-8333-333333333333" },
    ],
  ] as const)("%s refuses a specialist with no database access", async (_name, action, fields) => {
    requireAuth.mockResolvedValue(auth("specialist"));
    const result = await action({}, form(fields));
    expect(result.error).toBe("Only administrators can manage integrations.");
    expect(withTenant).not.toHaveBeenCalled();
  });

  it.each([
    ["createConnectionAction", createConnectionAction, {}],
    [
      "pauseConnectionAction",
      pauseConnectionAction,
      { connectionId: "33333333-3333-4333-8333-333333333333" },
    ],
  ] as const)("%s refuses a compliance user with no database access", async (_name, action, fields) => {
    requireAuth.mockResolvedValue(auth("compliance"));
    const result = await action({}, form(fields));
    expect(result.error).toBe("Only administrators can manage integrations.");
    expect(withTenant).not.toHaveBeenCalled();
  });

  it("an admin passes the role gate (reaches the database layer)", async () => {
    requireAuth.mockResolvedValue(auth("admin"));
    withTenant.mockRejectedValue(new Error("stop-after-role-gate"));
    await expect(
      pauseConnectionAction({}, form({ connectionId: "33333333-3333-4333-8333-333333333333" })),
    ).rejects.toThrow("stop-after-role-gate");
    expect(withTenant).toHaveBeenCalledTimes(1);
  });
});
