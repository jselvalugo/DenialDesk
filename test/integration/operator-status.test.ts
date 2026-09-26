import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/auth/password";
import { closeDatabase, systemDb } from "@/db/client";
import { users } from "@/db/schema";

// The pre-production operator status endpoint (docs/specs/operator-login.md): for the owner
// holding SEED_TOKEN, fixed words about the configuration and the account, never the values.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: vi.fn(), delete: vi.fn() }),
  headers: async () => new Headers(),
}));
// The shared per-network limit (5 per hour, covered by rate-limit.test.ts) would trip inside this
// file; the endpoint's own use of it is checked below.
vi.mock("@/lib/rate-limit", () => ({
  limitCurrentRequest: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 0 })),
}));

const { GET } = await import("@/app/api/preview/operator-status/route");
const { limitCurrentRequest } = await import("@/lib/rate-limit");

afterAll(() => closeDatabase());
afterEach(() => vi.unstubAllEnvs());

const token = "synthetic-seed-token-for-operator-status-0123456789";
const request = (bearer?: string) =>
  new Request("http://localhost/api/preview/operator-status", {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });

describe("GET /api/preview/operator-status", () => {
  it("is 404 in production, without the token, and with a wrong token", async () => {
    vi.stubEnv("SEED_TOKEN", token);
    vi.stubEnv("APP_ENV", "production");
    expect((await GET(request(token))).status).toBe(404);
    vi.stubEnv("APP_ENV", "preview");
    expect((await GET(request())).status).toBe(404);
    expect((await GET(request("w".repeat(40)))).status).toBe(404);
    vi.stubEnv("SEED_TOKEN", "");
    expect((await GET(request(token))).status).toBe(404);
  });

  it("is rate limited per network before the token is checked", async () => {
    vi.stubEnv("SEED_TOKEN", token);
    vi.stubEnv("APP_ENV", "preview");
    vi.mocked(limitCurrentRequest).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 90 });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect(limitCurrentRequest).toHaveBeenLastCalledWith("seed");
  });

  it("reports what is missing or unusable, then the synced account, without any value", async () => {
    vi.stubEnv("SEED_TOKEN", token);
    vi.stubEnv("APP_ENV", "preview");
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", "");
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", "Synthetic-Not-A-Hash-2026!");
    expect(await (await GET(request(token))).json()).toEqual({
      email: "missing",
      passwordHash: "malformed",
      account: "unconfigured",
      locked: null,
    });

    const email = `operator-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@synthetic.test`;
    const hash = await hashPassword("a synthetic operator passphrase");
    vi.stubEnv("PLATFORM_OPERATOR_EMAIL", email);
    vi.stubEnv("PLATFORM_OPERATOR_PASSWORD_HASH", hash);
    const response = await GET(request(token));
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({
      email: "set",
      passwordHash: "usable",
      account: "provisioned",
      locked: false,
    });
    expect(body).not.toContain(email);
    expect(body).not.toContain(hash.slice(-20));

    const [user] = await systemDb().select({ id: users.id }).from(users).where(eq(users.email, email));
    await systemDb()
      .update(users)
      .set({ lockedUntil: new Date(Date.now() + 60_000) })
      .where(eq(users.id, user!.id));
    expect(await (await GET(request(token))).json()).toMatchObject({ account: "current", locked: true });
  });
});
