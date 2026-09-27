import { beforeEach, describe, expect, it, vi } from "vitest";

const setCookie = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set: setCookie }) }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

const practiceSession = vi.fn();
const operatorSession = vi.fn();
vi.mock("@/auth/session", () => ({
  getSession: () => practiceSession(),
  getOperatorSession: () => operatorSession(),
}));

const where = vi.fn();
const set = vi.fn(() => ({ where }));
const update = vi.fn(() => ({ set }));
vi.mock("@/db/client", () => ({ systemDb: () => ({ update }) }));
vi.mock("@/db/schema", () => ({ users: { id: "users.id" } }));
vi.mock("drizzle-orm", () => ({ eq: (column: unknown, value: unknown) => ({ column, value }) }));

const { setLocale } = await import("./actions");

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe("setLocale (spec: internationalization, R-11.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    practiceSession.mockResolvedValue(null);
    operatorSession.mockResolvedValue(null);
  });

  it("ignores an unsupported language: no cookie, no write, no re-render", async () => {
    await setLocale(form({ locale: "fr" }));
    expect(setCookie).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sets an httpOnly, secure, SameSite=Lax, one-year cookie for a signed-out browser", async () => {
    await setLocale(form({ locale: "es" }));
    expect(setCookie).toHaveBeenCalledWith(
      "dd_locale",
      "es",
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 365 * 24 * 60 * 60,
      }),
    );
    expect(update).not.toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("stores the choice on the account only once MFA is complete", async () => {
    practiceSession.mockResolvedValue({ userId: "u-1", mfaVerified: false });
    await setLocale(form({ locale: "pt" }));
    expect(update).not.toHaveBeenCalled();

    practiceSession.mockResolvedValue({ userId: "u-1", mfaVerified: true });
    await setLocale(form({ locale: "pt" }));
    expect(set).toHaveBeenCalledWith({ locale: "pt" });
    expect(where).toHaveBeenCalledWith({ column: "users.id", value: "u-1" });
  });

  it("writes the operator's own row when the console picker is used, even with a practice session present", async () => {
    practiceSession.mockResolvedValue({ userId: "practice-user", mfaVerified: true });
    operatorSession.mockResolvedValue({ userId: "operator-user", mfaVerified: true });
    await setLocale(form({ locale: "es", realm: "operator" }));
    expect(where).toHaveBeenCalledWith({ column: "users.id", value: "operator-user" });
    await setLocale(form({ locale: "es" }));
    expect(where).toHaveBeenLastCalledWith({ column: "users.id", value: "practice-user" });
  });
});
