import { describe, expect, it } from "vitest";
import { decryptProviderTin, encryptProviderTin } from "@/lib/crypto/provider-tin";
import { CONTROL_NUMBER_KEY } from "./edi-837p";

// DB-free checks for docs/specs/claims.md C3a.

describe("the control number key", () => {
  // practice_settings.key is CHECKed against this pattern (drizzle/0029_appeals.sql); a key that breaks it
  // fails at the first insert, which only a database run would show.
  it("matches the practice_settings key CHECK", () => {
    expect(CONTROL_NUMBER_KEY).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
    expect(CONTROL_NUMBER_KEY).toBe("x12_control_number");
  });
});

describe("the encrypted TIN", () => {
  const key = Buffer.alloc(32, 7);

  it("has the field-encryption ciphertext shape, bound to its practice and provider", () => {
    const enc = encryptProviderTin("000000001", "tenant-a", "provider-a", key);
    expect(enc).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/);
    expect(enc).not.toContain("000000001");
    expect(decryptProviderTin(enc, "tenant-a", "provider-a", key)).toBe("000000001");
    expect(() => decryptProviderTin(enc, "tenant-b", "provider-a", key)).toThrow();
    expect(() => decryptProviderTin(enc, "tenant-a", "provider-b", key)).toThrow();
  });
});
