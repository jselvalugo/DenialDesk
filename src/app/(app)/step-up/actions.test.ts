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

const reserveAttempt = vi.fn();
const releaseAttempt = vi.fn();
const claimTotp = vi.fn();
vi.mock("@/auth/credentials", () => ({
  reserveAttempt: (...args: unknown[]) => reserveAttempt(...args),
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
    completeStepUpMfa.mockClear();
    auditSystem.mockClear();
    reserveAttempt.mockResolvedValue(true);
    claimTotp.mockClear();
    releaseAttempt.mockClear();
    limitCurrentRequest.mockClear();
    selectResult.totpSecretEnc = "enc";
    selectResult.mfaEnrolledAt = new Date();
  });

  it("on success records a fresh verification, audits with the return path, and redirects there", async () => {
    claimTotp.mockResolvedValue("ok");
    await expect(
      verifyStepUp({}, form({ code: "123456", returnTo: "/settings/integrations/abc" })),
    ).rejects.toThrow("redirect:/settings/integrations/abc");
    expect(completeStepUpMfa).toHaveBeenCalledWith(auth.sessionId);
    // resetLockout=false is passed as claimTotp's 4th argument (never resets sign-in lockout).
    expect(claimTotp).toHaveBeenCalledWith(expect.anything(), "123456", false, false);
    expect(auditSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.step_up_verified",
        tenantId: auth.tenantId,
        entityType: "session",
        entityId: auth.sessionId,
        metadata: { path: "/settings/integrations/abc" },
      }),
    );
    // A success returns the attempt it reserved, so successful step-ups never add up to a lockout.
    expect(releaseAttempt).toHaveBeenCalledWith(auth.userId);
  });

  it("audits the path without its query string", async () => {
    claimTotp.mockResolvedValue("ok");
    await expect(
      verifyStepUp({}, form({ code: "123456", returnTo: "/settings/integrations/abc?tab=history" })),
    ).rejects.toThrow("redirect:/settings/integrations/abc?tab=history");
    expect(auditSystem).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { path: "/settings/integrations/abc" } }),
    );
  });

  it.each(["https://evil.example/x", "//evil.example", "/\\evil.example", "/claims/abc", ""])(
    "never redirects to %j (open redirect): falls back to Settings › Integrations",
    async (returnTo) => {
      claimTotp.mockResolvedValue("ok");
      await expect(verifyStepUp({}, form({ code: "123456", returnTo }))).rejects.toThrow(
        "redirect:/settings/integrations",
      );
    },
  );

  it("refuses a mismatched code without completing step-up", async () => {
    claimTotp.mockResolvedValue("mismatch");
    const result = await verifyStepUp({}, form({ code: "000000", returnTo: "/patients" }));
    expect(result.error).toBeTruthy();
    expect(completeStepUpMfa).not.toHaveBeenCalled();
    expect(releaseAttempt).not.toHaveBeenCalled();
    expect(auditSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "auth.step_up_failed",
        tenantId: auth.tenantId,
        metadata: { path: "/patients" },
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

  it("refuses when the account is locked out, never reaching claimTotp", async () => {
    reserveAttempt.mockResolvedValue(false);
    const result = await verifyStepUp({}, form({ code: "123456" }));
    expect(result.error).toBeTruthy();
    expect(claimTotp).not.toHaveBeenCalled();
    expect(completeStepUpMfa).not.toHaveBeenCalled();
  });
});
