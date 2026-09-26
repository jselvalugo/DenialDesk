import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, totpAt, verifyTotp } from "./totp";

// RFC 6238 Appendix B test secret (SHA1): ASCII "12345678901234567890".
const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("matches RFC 6238 SHA1 test vectors (8 digits)", () => {
    expect(totpAt(rfcSecret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(totpAt(rfcSecret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(totpAt(rfcSecret, Math.floor(20000000000 / 30), 8)).toBe("65353130");
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from("synthetic-secret-bytes");
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
  });

  it("accepts the current code and one step of drift, rejects older codes", () => {
    const secret = generateTotpSecret();
    const now = 1_790_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpAt(secret, step), null, now)).toBe(step);
    expect(verifyTotp(secret, totpAt(secret, step - 1), null, now)).toBe(step - 1);
    expect(verifyTotp(secret, totpAt(secret, step - 2), null, now)).toBeNull();
  });

  it("rejects a replayed code", () => {
    const secret = generateTotpSecret();
    const now = 1_790_000_000_000;
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, totpAt(secret, step), step, now)).toBeNull();
  });

  it("rejects malformed codes", () => {
    expect(verifyTotp(generateTotpSecret(), "12345", null)).toBeNull();
    expect(verifyTotp(generateTotpSecret(), "abcdef", null)).toBeNull();
  });
});
