import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect:${to}`);
  }),
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));
vi.mock("./session", () => ({ getSession: vi.fn(), requireAuth: vi.fn() }));
vi.mock("./demo", async () => {
  const email = (e: string) =>
    e.toLowerCase().startsWith("guest-") && e.toLowerCase().endsWith("@demo.denialdesk.test");
  return { isDemoGuestEmail: email };
});

const { isPlatformOperator, requireOperator } = await import("./operator");
const session = await import("./session");

describe("isPlatformOperator", () => {
  const operator = "owner@synthetic.test";

  it("accepts the configured email with a full password + MFA session (case-insensitive)", () => {
    expect(isPlatformOperator({ email: "Owner@Synthetic.test", authMethod: "password_mfa" }, operator)).toBe(
      true,
    );
  });

  it("rejects everyone else", () => {
    expect(
      isPlatformOperator({ email: "someone@synthetic.test", authMethod: "password_mfa" }, operator),
    ).toBe(false);
  });

  it("rejects demo sessions, even for the configured email", () => {
    expect(isPlatformOperator({ email: operator, authMethod: "demo" }, operator)).toBe(false);
  });

  it("rejects demo guest accounts even if configured as the operator", () => {
    const guest = "guest-abc@demo.denialdesk.test";
    expect(isPlatformOperator({ email: guest, authMethod: "password_mfa" }, guest)).toBe(false);
  });

  it("is off when no operator is configured", () => {
    expect(isPlatformOperator({ email: operator, authMethod: "password_mfa" }, undefined)).toBe(false);
  });
});

describe("requireOperator", () => {
  const operator = "owner@synthetic.test";
  const signedIn = (authMethod: "password_mfa" | "demo", email: string) => {
    vi.mocked(session.getSession).mockResolvedValue({ authMethod, email } as never);
    vi.mocked(session.requireAuth).mockResolvedValue({ authMethod, email } as never);
  };

  beforeEach(() => {
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", operator);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends signed-out visitors to sign-in", async () => {
    vi.mocked(session.getSession).mockResolvedValue(null);
    await expect(requireOperator()).rejects.toThrow("redirect:/login");
  });

  it("sends demo sessions to sign-in instead of a dead-end 404", async () => {
    signedIn("demo", "guest-abc@demo.denialdesk.test");
    await expect(requireOperator()).rejects.toThrow("redirect:/login?reason=account");
  });

  it("is a 404 for signed-in practice users who aren't the operator", async () => {
    signedIn("password_mfa", "someone@synthetic.test");
    await expect(requireOperator()).rejects.toThrow("notFound");
  });

  it("lets the operator in", async () => {
    signedIn("password_mfa", operator);
    await expect(requireOperator()).resolves.toMatchObject({ email: operator });
  });
});
