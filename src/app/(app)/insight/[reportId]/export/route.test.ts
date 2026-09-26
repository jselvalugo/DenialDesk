import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAuth = vi.fn();
vi.mock("@/auth/session", () => ({ requireAuth: () => requireAuth() }));

// withTenant/DB must never be reached for a rejected request; importing route.ts must not touch
// the database at module-load time, so no DB mock is needed for these checks.
const { POST } = await import("./route");

const auth = (role: string) => ({
  sessionId: "s1",
  userId: "11111111-1111-4111-8111-111111111111",
  tenantId: "22222222-2222-4222-8222-222222222222",
  displayName: "Test User",
  tenantName: "Synthetic Practice (synthetic)",
  role,
  tenantKind: "customer",
  authMethod: "password",
  email: "test@synthetic.test",
});

function postRequest(opts: { origin?: string; host?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.origin !== undefined) headers.origin = opts.origin;
  if (opts.host !== undefined) headers.host = opts.host;
  const body = new URLSearchParams({ dateFrom: "2026-01-01", dateTo: "2026-01-02" });
  return new Request("http://localhost/insight/denials-by-category/export", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /insight/[reportId]/export", () => {
  beforeEach(() => requireAuth.mockClear());

  it("returns 403 for a specialist (export limited to admin/manager/compliance)", async () => {
    requireAuth.mockResolvedValue(auth("specialist"));
    const res = await POST(postRequest({ origin: "http://localhost", host: "localhost" }), {
      params: Promise.resolve({ reportId: "denials-by-category" }),
    });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown/planned report id, before checking role", async () => {
    requireAuth.mockResolvedValue(auth("specialist"));
    const res = await POST(postRequest({ origin: "http://localhost", host: "localhost" }), {
      params: Promise.resolve({ reportId: "prompt-pay-scorecard" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects a cross-origin POST even from an exporter role, before touching the database", async () => {
    requireAuth.mockResolvedValue(auth("admin"));
    const res = await POST(postRequest({ origin: "https://evil.example", host: "localhost" }), {
      params: Promise.resolve({ reportId: "denials-by-category" }),
    });
    expect(res.status).toBe(403);
    // requireAuth was never even called: the origin check runs first.
    expect(requireAuth).not.toHaveBeenCalled();
  });
});
