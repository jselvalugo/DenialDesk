import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptField, encryptField } from "./field";

const key = randomBytes(32);

describe("field encryption", () => {
  it("round-trips a value", () => {
    expect(decryptField(encryptField("SYN123456789", key), key)).toBe("SYN123456789");
  });

  it("produces different ciphertext for the same value", () => {
    expect(encryptField("SYN1", key)).not.toBe(encryptField("SYN1", key));
  });

  it("does not contain the plaintext", () => {
    expect(encryptField("SYNMEMBER42", key)).not.toContain("SYNMEMBER42");
  });

  it("rejects tampered ciphertext", () => {
    const parts = encryptField("SYN1", key).split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptField(parts.join("."), key)).toThrow();
  });

  it("rejects the wrong key", () => {
    expect(() => decryptField(encryptField("SYN1", key), randomBytes(32))).toThrow();
  });
});
