import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDatabase, systemDb } from "@/db/client";
import { hit, limitFor, retryMessage } from "@/lib/rate-limit";

afterAll(() => closeDatabase());

const now = new Date("2026-09-26T10:00:30Z");

describe("rate limiter", () => {
  it("allows up to the limit and blocks the next attempt (demo: 10 per 10 minutes)", async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}-${randomUUID()}`;
    const { limit } = limitFor("demo_login");
    expect(limit).toBe(10);
    for (let i = 1; i <= limit; i++)
      expect((await hit("demo_login", ip, now)).allowed, `hit ${i}`).toBe(true);
    const blocked = await hit("demo_login", ip, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(570); // window ends at 10:10:00
  });

  it("starts fresh in the next window", async () => {
    const ip = randomUUID();
    for (let i = 0; i < 11; i++) await hit("demo_login", ip, now);
    expect((await hit("demo_login", ip, new Date("2026-09-26T10:10:00Z"))).allowed).toBe(true);
  });

  it("keeps networks and buckets separate", async () => {
    const a = randomUUID();
    const b = randomUUID();
    for (let i = 0; i < 11; i++) await hit("demo_login", a, now);
    expect((await hit("demo_login", b, now)).allowed).toBe(true);
    expect((await hit("sign_in", a, now)).allowed).toBe(true);
  });

  it("counts atomically under concurrent hits", async () => {
    const ip = randomUUID();
    const results = await Promise.all(Array.from({ length: 25 }, () => hit("demo_login", ip, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it("stores hashed keys, never raw IPs", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}`;
    await hit("sign_in", ip, now);
    const rows = await systemDb().execute<{ n: string }>(
      sql`select count(*) as n from rate_limits where key_hash = ${ip} or key_hash like ${`%${ip}%`}`,
    );
    expect(Number(rows.rows[0]?.n)).toBe(0);
  });

  it("is not readable by the app role", async () => {
    await expect(
      systemDb().transaction(async (tx) => {
        await tx.execute(sql`set local role denialdesk_app`);
        await tx.execute(sql`select * from rate_limits limit 1`);
      }),
    ).rejects.toThrow();
  });

  it("explains when to try again", () => {
    expect(retryMessage("demo sessions", { allowed: false, retryAfterSeconds: 570 })).toBe(
      "Too many demo sessions from your network. Try again in 10 minutes.",
    );
    expect(retryMessage("sign-in attempts", { allowed: false, retryAfterSeconds: 20 })).toBe(
      "Too many sign-in attempts from your network. Try again in 1 minute.",
    );
  });
});
