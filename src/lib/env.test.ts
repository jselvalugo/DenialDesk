import { describe, expect, it } from "vitest";
import { parseEnv } from "./env";

const valid = {
  APP_ENV: "development",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
};

describe("parseEnv", () => {
  it("accepts a valid environment", () => {
    expect(parseEnv(valid)).toEqual(valid);
  });

  it("rejects an unknown APP_ENV", () => {
    expect(() => parseEnv({ ...valid, APP_ENV: "staging" })).toThrow(/APP_ENV/);
  });

  it("rejects a non-Postgres DATABASE_URL", () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: "mysql://u:p@localhost/db" })).toThrow(/DATABASE_URL/);
  });

  it("rejects an encryption key of the wrong length", () => {
    expect(() => parseEnv({ ...valid, FIELD_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(
      /FIELD_ENCRYPTION_KEY/,
    );
  });

  it("names missing variables without echoing any values", () => {
    const secret = "postgres://user:super-secret@localhost/db";
    try {
      parseEnv({ DATABASE_URL: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain("APP_ENV");
      expect((error as Error).message).not.toContain("super-secret");
    }
  });
});
