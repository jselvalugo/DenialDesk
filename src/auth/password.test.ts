import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const hash = await hashPassword("synthetic-correct-horse");
    expect(hash.startsWith("scrypt$131072$8$1$")).toBe(true);
    expect(hash).not.toContain("synthetic-correct-horse");
    expect(await verifyPassword("synthetic-correct-horse", hash)).toBe(true);
    expect(await verifyPassword("synthetic-wrong-horse", hash)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same-password-123")).not.toBe(await hashPassword("same-password-123"));
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("anything", "plaintext")).toBe(false);
  });

  it("enforces length, not composition", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("all lowercase words ok")).toBeNull();
  });
});
