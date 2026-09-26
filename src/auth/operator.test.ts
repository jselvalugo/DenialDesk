import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
}));
vi.mock("./session", () => ({ getOperatorSession: vi.fn(), revokeSession: vi.fn() }));
vi.mock("./operator-account", async () => {
  const email = () => process.env.PLATFORM_OPERATOR_EMAIL?.trim().toLowerCase() || null;
  return {
    isOperatorEmail: (e: string) => email() !== null && e.trim().toLowerCase() === email(),
    hasPracticeMembership: vi.fn(),
  };
});

const { requireOperator } = await import("./operator");
const session = await import("./session");
const account = await import("./operator-account");

describe("requireOperator", () => {
  const operator = "owner@synthetic.test";
  const operatorSession = (overrides: Record<string, unknown> = {}) =>
    vi.mocked(session.getOperatorSession).mockResolvedValue({
      sessionId: "s1",
      userId: "u1",
      email: "Owner@Synthetic.test",
      displayName: "Platform operator",
      mfaVerified: true,
      mfaEnrolled: true,
      authMethod: "operator",
      ...overrides,
    } as never);

  beforeEach(() => {
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", operator);
    vi.mocked(account.hasPracticeMembership).mockResolvedValue(false);
    vi.mocked(session.revokeSession).mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends anyone without an operator session to the operator sign-in", async () => {
    vi.mocked(session.getOperatorSession).mockResolvedValue(null);
    await expect(requireOperator()).rejects.toThrow("redirect:/operator/login");
  });

  it("sends a password-only session to two-step verification (or its setup)", async () => {
    operatorSession({ mfaVerified: false });
    await expect(requireOperator()).rejects.toThrow("redirect:/operator/login/mfa");
    operatorSession({ mfaVerified: false, mfaEnrolled: false });
    await expect(requireOperator()).rejects.toThrow("redirect:/operator/login/mfa/setup");
  });

  it("lets the operator in (email match is case-insensitive)", async () => {
    operatorSession();
    await expect(requireOperator()).resolves.toMatchObject({ userId: "u1", sessionId: "s1" });
    expect(session.revokeSession).not.toHaveBeenCalled();
  });

  it("ends the session when the account no longer matches the configured email", async () => {
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", "someone-else@synthetic.test");
    operatorSession();
    await expect(requireOperator()).rejects.toThrow("redirect:/operator/login");
    expect(session.revokeSession).toHaveBeenCalledWith("s1");
  });

  it("ends the session when the console is switched off", async () => {
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", "");
    operatorSession();
    await expect(requireOperator()).rejects.toThrow("redirect:/operator/login");
    expect(session.revokeSession).toHaveBeenCalledWith("s1");
  });

  it("never treats an account with a practice membership as the operator (fail closed)", async () => {
    vi.mocked(account.hasPracticeMembership).mockResolvedValue(true);
    operatorSession();
    await expect(requireOperator()).rejects.toThrow("redirect:/operator/login");
    expect(session.revokeSession).toHaveBeenCalledWith("s1");
  });
});
