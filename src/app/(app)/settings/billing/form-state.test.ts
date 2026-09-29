import { describe, expect, it } from "vitest";
import { BillingSettingsError } from "@/domain/settings/billing";
import { en } from "@/i18n/messages/en";
import { createTranslator } from "@/i18n/translate";
import { billingActor, billingFailure } from "./form-state";

const t = createTranslator(en.settings, "en");
const session = { tenantId: "t", userId: "u", role: "admin" as const };
const verifiedAt = new Date("2026-09-29T12:00:00.000Z");

describe("billingActor (step-up from the session, R-7.2.2)", () => {
  it("counts a verification within five minutes, inclusive, and not a minute later", () => {
    const at = (ms: number) =>
      billingActor({ ...session, mfaVerifiedAt: verifiedAt }, new Date(verifiedAt.getTime() + ms));
    expect(at(4 * 60_000 + 59_000).recentMfa).toBe(true);
    expect(at(5 * 60_000).recentMfa).toBe(true);
    expect(at(5 * 60_000 + 1000).recentMfa).toBe(false);
  });

  it("never counts a session that recorded no verification", () => {
    expect(billingActor({ ...session, mfaVerifiedAt: null }, verifiedAt).recentMfa).toBe(false);
  });
});

describe("billingFailure", () => {
  it("maps each refusal to a translated message and a step-up flag, with no value", () => {
    expect(billingFailure(new BillingSettingsError("forbidden"), t).error).toBe(t("billing.error.notAdmin"));
    expect(billingFailure(new BillingSettingsError("not_found"), t).error).toBe(t("billing.error.notFound"));
    expect(billingFailure(new BillingSettingsError("step_up"), t)).toEqual({
      error: t("billing.error.stepUpRequired"),
      stepUpRequired: true,
    });
  });

  it("puts a validation message on its field, with the limit filled in", () => {
    const state = billingFailure(
      new BillingSettingsError("validation", [
        { field: "lastName", key: "billing.error.tooLong", max: 60 },
        { field: "state", key: "billing.error.state" },
      ]),
      t,
    );
    expect(state.fieldErrors).toEqual({
      lastName: "Use at most 60 characters.",
      state: t("billing.error.state"),
    });
  });

  it("rethrows what it doesn't know, so a bug isn't hidden", () => {
    expect(() => billingFailure(new Error("boom"), t)).toThrow("boom");
  });
});
