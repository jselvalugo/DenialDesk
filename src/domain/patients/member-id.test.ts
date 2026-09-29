import { describe, expect, it } from "vitest";
import { memberIdBelongsToClaimPayer } from "./member-id";

// R-5.1.2: the member ID on file is the primary payer's; it is revealed only on that payer's claims.
const PAYER_A = "11111111-1111-4111-8111-111111111111";
const PAYER_B = "22222222-2222-4222-8222-222222222222";

describe("memberIdBelongsToClaimPayer", () => {
  it("allows the claim's payer when it is the patient's primary payer", () => {
    expect(memberIdBelongsToClaimPayer(PAYER_A, PAYER_A)).toBe(true);
  });

  it("refuses a claim billed to another payer", () => {
    expect(memberIdBelongsToClaimPayer(PAYER_A, PAYER_B)).toBe(false);
  });

  it("refuses a patient with no primary payer", () => {
    expect(memberIdBelongsToClaimPayer(null, PAYER_A)).toBe(false);
  });
});
