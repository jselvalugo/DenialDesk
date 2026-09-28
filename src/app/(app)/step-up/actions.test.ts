import { beforeEach, describe, expect, it, vi } from "vitest";

// Step-up MFA (R-7.2.2): success records a fresh verification, gives back its own attempt, and
// redirects to a safe return path; a wrong code, a reused code, and lockout are all refused without
// ever calling completeStepUpMfa, and never give an attempt back.

const requireAuth = vi.fn();
const completeStepUpMfa = vi.fn();
const clientIp = vi.fn(async () => "192.0.2.1");
vi.mock("@/auth/session", () => ({
  requireAuth: () => requireAuth(),
  completeStepUpMfa: (...args: unknown[]) => completeStepUpMfa(...args),
  clientIp: () => clientIp(),
}));

const reserveStepUpAttempt = vi.fn();
const releaseAttempt = vi.fn();
const claimTotp = vi.fn();
vi.mock("@/auth/credentials", () => ({
  reserveStepUpAttempt: (...args: unknown[]) => reserveStepUpAttempt(...args),
  releaseAttempt: (...args: unknown[]) => releaseAttempt(...args),
  claimTotp: (...args: unknown[]) => claimTotp(...args),
  codeSchema: {
    safeParse: (value: { code: unknown }) =>
      typeof value.code === "string" && /^\d{6}$/.test(value.code)
        ? { success: true, data: { code: value.code } }
        : { success: false },
  },
  rateLimited: async () => ({ error: "Too many attempts." }),
}));

const limitCurrentRequest = vi.fn(async () => ({ allowed: true }));
vi.mock("@/lib/rate-limit", () => ({ limitCurrentRequest: () => limitCurrentRequest() }));

const auditSystem = vi.fn();
vi.mock("@/lib/audit", () => ({ auditSystem: (...args: unknown[]) => auditSystem(...args) }));

const selectResult: {
  id: string;
  totpSecretEnc: string | null;
  totpLastStep: number | null;
  mfaEnrolledAt: Date | null;
} = {
  id: "11111111-1111-4111-8111-111111111111",
  totpSecretEnc: "enc",
  totpLastStep: null,
  mfaEnrolledAt: new Date(),
};
vi.mock("@/db/client", () => ({
  systemDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [selectResult] }),
      }),
    }),
  }),
}));
vi.mock("@/db/schema", () => ({ users: { id: "users.id" } }));
vi.mock("drizzle-orm", () => ({ eq: (column: unknown, value: unknown) => ({ column, value }) }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

const { verifyStepUp } = await import("./actions");

const auth = {
  sessionId: "s1",
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
};

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("verifyStepUp", () => {
  beforeEach(() => {
    requireAuth.mockResolvedValue(auth);
    completeStepUpMfa.mockReset();
    completeStepUpMfa.mockResolvedValue(true);
    auditSystem.mockClear();
    reserveStepUpAttempt.mockResolvedValue("ok");
    claimTotp.mockClear();
    releaseAttempt.mockClear();
    limitCurrentRequest.mockClear();
    selectResult.totpSecretEnc = "enc";
    selectResult.mfaEnrolledAt = new Date();
  });

  const ID = "0b9f5a5e-1f0a-4c3e-8d6e-2b1a9c7d4e10";

  it("on success records a fresh verification, audits the route and connection ID, and redirects there", async () => {
    claimTotp.mockResolvedValue("ok");
    await expect(
      verifyStepUp({}, form({ code: "123456", returnTo: `/settings/integrations/${ID}` })),
    ).rejects.toThrow(`redirect:/settings/integrations/${ID}`);
    expect(completeStepUpMfa).toHaveBeenCalledWith(auth.sessionId);
    // resetLockout=false is passed as claimTotp's 4th argument (never resets sign-in lockout).
    expect(claimTotp).toHaveBeenCalledWith(expect.anything(), "123456", false, false);
    expect(auditSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.step_up_verified",
        tenantId: auth.tenantId,
        entityType: "session",
        entityId: auth.sessionId,
        metadata: { route: "/settings/integrations/[id]", route_id: ID },
      }),
    );
    // A success returns the attempt it reserved, so successful step-ups never add up to a lockout.
    expect(releaseAttempt).toHaveBeenCalledWith(auth.userId);
  });

  it("audits a template, never the raw path or its query string", async () => {
    claimTotp.mockResolvedValue("ok");
    await expect(
      verifyStepUp({}, form({ code: "123456", returnTo: `/settings/integrations/${ID}?note=Jane+Doe` })),
    ).rejects.toThrow(`redirect:/settings/integrations/${ID}`);
    const [event] = auditSystem.mock.calls.at(-1) as [{ metadata: Record<string, unknown> }];
    expect(JSON.stringify(event.metadata)).not.toMatch(/Jane|note/);
  });

  it.each([
    "https://evil.example/x",
    "//evil.example",
    "/\\evil.example",
    "/claims/abc",
    "/settings/integrations/Jane%20Doe",
    "/settings/integrations/not-a-uuid",
    `/settings/integrations/${"a".repeat(300)}`,
    "",
  ])(
    "never redirects to %j: falls back to Settings › Integrations, auditing only the fallback",
    async (returnTo) => {
      claimTotp.mockResolvedValue("ok");
      await expect(verifyStepUp({}, form({ code: "123456", returnTo }))).rejects.toThrow(
        "redirect:/settings/integrations",
      );
      expect(auditSystem).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { route: "/settings/integrations", route_id: null } }),
      );
    },
  );

  it("does not audit a verification, and sends the browser to sign in, when the session was revoked meanwhile", async () => {
    claimTotp.mockResolvedValue("ok");
    completeStepUpMfa.mockResolvedValue(false);
    await expect(
      verifyStepUp({}, form({ code: "123456", returnTo: "/settings/integrations" })),
    ).rejects.toThrow("redirect:/login");
    expect(auditSystem).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.step_up_verified" }),
    );
  });

  it("refuses a mismatched code without completing step-up", async () => {
    claimTotp.mockResolvedValue("mismatch");
    const result = await verifyStepUp({}, form({ code: "000000", returnTo: `/settings/integrations/${ID}` }));
    expect(result.error).toBeTruthy();
    expect(completeStepUpMfa).not.toHaveBeenCalled();
    expect(releaseAttempt).not.toHaveBeenCalled();
    expect(auditSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.step_up_failed",
        tenantId: auth.tenantId,
        metadata: { route: "/settings/integrations/[id]", route_id: ID },
      }),
    );
    // A failure never clears the sign-in lockout counter: the reset flag is false either way.
    expect(claimTotp).toHaveBeenCalledWith(expect.anything(), "000000", false, false);
  });

  it("refuses a reused code without completing step-up", async () => {
    claimTotp.mockResolvedValue("reused");
    const result = await verifyStepUp({}, form({ code: "123456" }));
    expect(result.error).toBeTruthy();
    expect(completeStepUpMfa).not.toHaveBeenCalled();
    expect(releaseAttempt).not.toHaveBeenCalled();
  });

  it("refuses the attempt that would reach the limit before any code is checked, and audits the lock it sets", async () => {
    reserveStepUpAttempt.mockResolvedValue("locked_now");
    const result = await verifyStepUp({}, form({ code: "123456", returnTo: `/settings/integrations/${ID}` }));
    expect(result.error).toMatch(/locked for up to 15 minutes/);
    // No code was checked, nothing was verified, no attempt was given back.
    expect(claimTotp).not.toHaveBeenCalled();
    expect(completeStepUpMfa).not.toHaveBeenCalled();
    expect(releaseAttempt).not.toHaveBeenCalled();
    expect(auditSystem).toHaveBeenCalledTimes(1);
    expect(auditSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.locked_out",
        actorUserId: auth.userId,
        tenantId: auth.tenantId,
        entityType: "session",
        entityId: auth.sessionId,
        metadata: { route: "/settings/integrations/[id]", route_id: ID, source: "step_up" },
      }),
    );
    // The submitted code never reaches the log.
    expect(JSON.stringify(auditSystem.mock.calls)).not.toContain("123456");
  });

  it("refuses an attempt on an already locked account, audited as refused, never reaching claimTotp", async () => {
    reserveStepUpAttempt.mockResolvedValue("locked");
    const result = await verifyStepUp({}, form({ code: "123456", returnTo: `/settings/integrations/${ID}` }));
    expect(result.error).toMatch(/locked for up to 15 minutes/);
    expect(claimTotp).not.toHaveBeenCalled();
    expect(completeStepUpMfa).not.toHaveBeenCalled();
    expect(auditSystem).toHaveBeenCalledTimes(1);
    expect(auditSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.step_up_refused",
        actorUserId: auth.userId,
        tenantId: auth.tenantId,
        metadata: { route: "/settings/integrations/[id]", route_id: ID, reason: "locked" },
      }),
    );
    expect(JSON.stringify(auditSystem.mock.calls)).not.toContain("123456");
  });
});
