import { beforeEach, describe, expect, it, vi } from "vitest";

// docs/specs/settings-and-custom-fields.md S2 PR4: only administrators and managers may change a
// payer's custom field values (`canEditPayerFields`). This is checked before `withTenant`/the
// database is ever touched, so the forbidden path needs no DB mock — only `requireAuth` and the
// `next/headers` shape `getT` reads outside a real request (route.test.ts's pattern). The
// permitted path below mocks the database layer instead of hitting a real one (that's
// `test:integration`'s job) and just confirms the action reaches it and redirects.

const requireAuth = vi.fn();
vi.mock("@/auth/session", () => ({ requireAuth: () => requireAuth() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));

class RedirectSignal extends Error {
  constructor(readonly url: string) {
    super("NEXT_REDIRECT");
  }
}
const redirect = vi.fn((url: string) => {
  throw new RedirectSignal(url);
});
vi.mock("next/navigation", () => ({ redirect: (url: string) => redirect(url) }));

const withTenant = vi.fn((_auth: unknown, fn: (tx: unknown) => unknown) => fn({}));
vi.mock("@/db/tenant", () => ({
  withTenant: (...args: Parameters<typeof withTenant>) => withTenant(...args),
}));

const getPayer = vi.fn();
vi.mock("@/domain/payers/queries", () => ({ getPayer: (...args: unknown[]) => getPayer(...args) }));

const activeCustomFields = vi.fn();
vi.mock("@/domain/settings/queries", () => ({
  activeCustomFields: (...args: unknown[]) => activeCustomFields(...args),
}));

const parseCustomFieldInputs = vi.fn();
vi.mock("@/domain/custom-fields/form-inputs", () => ({
  parseCustomFieldInputs: (...args: unknown[]) => parseCustomFieldInputs(...args),
}));

const saveValuesForRecord = vi.fn();
class CustomFieldValueError extends Error {
  constructor(
    message: string,
    readonly key?: string,
  ) {
    super(message);
  }
}
vi.mock("@/domain/custom-fields/values", () => ({
  saveValuesForRecord: (...args: unknown[]) => saveValuesForRecord(...args),
  CustomFieldValueError,
}));

const { savePayerCustomFields } = await import("./actions");

const PAYER_ID = "33333333-3333-4333-8333-333333333333";

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

// Opaque as far as this action cares: it never inspects the token's shape itself (that's
// `customFieldValuesToken`'s job, exercised in test:integration), only threads it through.
const OPAQUE_TOKEN = "opaque-test-token";

function form() {
  const data = new FormData();
  data.set("payerId", PAYER_ID);
  data.set("expectedValuesToken", OPAQUE_TOKEN);
  return data;
}

describe("savePayerCustomFields (role gate: canEditPayerFields)", () => {
  beforeEach(() => requireAuth.mockClear());

  it.each(["specialist", "compliance"])("refuses a %s with no database access", async (role) => {
    requireAuth.mockResolvedValue(auth(role));
    const result = await savePayerCustomFields({}, form());
    expect(result.error).toBe("Only administrators and managers can change a payer's custom fields.");
  });
});

describe("savePayerCustomFields (admin/manager: reaches the database and redirects)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTenant.mockImplementation((_auth: unknown, fn: (tx: unknown) => unknown) => fn({}));
    getPayer.mockResolvedValue({ id: PAYER_ID, name: "Test Payer" });
    activeCustomFields.mockResolvedValue([]);
    parseCustomFieldInputs.mockReturnValue(new Map());
    saveValuesForRecord.mockResolvedValue([]);
  });

  it.each(["admin", "manager"])(
    "lets a %s through to withTenant and redirects back to the payer",
    async (role) => {
      requireAuth.mockResolvedValue(auth(role));
      await expect(savePayerCustomFields({}, form())).rejects.toBeInstanceOf(RedirectSignal);
      expect(withTenant).toHaveBeenCalledTimes(1);
      expect(getPayer).toHaveBeenCalledWith(expect.anything(), PAYER_ID);
      expect(saveValuesForRecord).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ role }),
        "payer",
        PAYER_ID,
        expect.any(Map),
        expect.anything(),
        OPAQUE_TOKEN,
      );
      expect(redirect).toHaveBeenCalledWith(`/settings/payers/${PAYER_ID}`);
      expect(revalidatePath).toHaveBeenCalledWith(`/settings/payers/${PAYER_ID}`);
      expect(revalidatePath).toHaveBeenCalledWith("/settings/payers");
    },
  );

  it("returns a reload error, writes nothing, and never redirects when the payer id doesn't resolve (bad id or another tenant's payer)", async () => {
    requireAuth.mockResolvedValue(auth("admin"));
    getPayer.mockResolvedValue(null);
    const result = await savePayerCustomFields({}, form());
    expect(result.error).toBe("Reload the page and try again.");
    expect(saveValuesForRecord).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
