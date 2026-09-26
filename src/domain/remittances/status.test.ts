import { describe, expect, it } from "vitest";
import { isBalanced, postedClaimStatus } from "./status";

describe("postedClaimStatus", () => {
  it("is denied for CLP02 4 or nothing paid", () => {
    expect(postedClaimStatus({ statusCode: "4", paidTotalCents: 500, adjustments: [] })).toBe("denied");
    expect(postedClaimStatus({ statusCode: "1", paidTotalCents: 0, adjustments: [] })).toBe("denied");
  });

  it("is paid when only patient responsibility and the fee-schedule reduction (CO-45) remain", () => {
    expect(
      postedClaimStatus({
        statusCode: "1",
        paidTotalCents: 8_000,
        adjustments: [
          { group: "CO", carc: "45", cents: 1_500 },
          { group: "PR", carc: "2", cents: 500 },
        ],
      }),
    ).toBe("paid");
  });

  it("is partially paid when any other adjustment reduced the payment", () => {
    expect(
      postedClaimStatus({
        statusCode: "1",
        paidTotalCents: 8_000,
        adjustments: [{ group: "CO", carc: "97", cents: 2_000 }],
      }),
    ).toBe("partially_paid");
  });
});

describe("isBalanced", () => {
  it("balances when claims paid minus provider adjustments equal the payment", () => {
    expect(isBalanced({ totalPaidCents: 900, providerAdjustmentCents: 100, claimsPaidCents: 1_000 })).toBe(
      true,
    );
    expect(isBalanced({ totalPaidCents: 1_000, providerAdjustmentCents: 100, claimsPaidCents: 1_000 })).toBe(
      false,
    );
  });
});
