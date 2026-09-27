import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { users } from "@/db/schema";
import { expectDbError } from "./helpers";

// docs/specs/internationalization.md: users.locale holds one of the supported codes or null (migration 0033).
afterAll(closeDatabase);

describe("users.locale (R-11.1)", () => {
  const email = (tag: string) => `locale-${tag}-${Date.now()}@synthetic.denialdesk.test`;
  const base = { displayName: "Synthetic Locale Tester", passwordHash: "x" };
  let existingId: string | undefined;

  it("accepts the supported languages and null", async () => {
    const [row] = await systemDb()
      .insert(users)
      .values({ ...base, email: email("ok"), locale: "pt" })
      .returning({ locale: users.locale });
    expect(row?.locale).toBe("pt");
    const [none] = await systemDb()
      .insert(users)
      .values({ ...base, email: email("null") })
      .returning({ id: users.id, locale: users.locale });
    expect(none?.locale).toBeNull();
    existingId = none?.id;
  });

  it("rejects any other value at the database", async () => {
    await expectDbError(
      systemDb()
        .insert(users)
        .values({ ...base, email: email("bad"), locale: "fr" })
        .returning(),
      /users_locale_check/,
    );
    expect(existingId).toBeDefined();
    await expectDbError(
      systemDb().execute(sql`update users set locale = 'pt-BR' where id = ${existingId}`),
      /users_locale_check/,
    );
  });
});
