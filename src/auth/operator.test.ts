import { describe, expect, it, vi } from "vitest";

vi.mock("./session", () => ({ getSession: vi.fn(), requireAuth: vi.fn() }));
vi.mock("./demo", async () => {
  const email = (e: string) =>
    e.toLowerCase().startsWith("guest-") && e.toLowerCase().endsWith("@demo.denialdesk.test");
  return { isDemoGuestEmail: email };
});

const { isPlatformOperator } = await import("./operator");

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
