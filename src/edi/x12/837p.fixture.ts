// Fully synthetic 837P input for tests (R-15.1). Names, IDs, addresses, and the TIN identify nobody:
// the member ID starts SYN, the TIN is not an assignable EIN, streets are "Synthetic Way", the NPI is the
// well-known documentation example, and the envelope is the fixed synthetic one.
import { SYNTHETIC_ENVELOPE, type Claim837Input } from "./837p";

export function syntheticClaim(overrides: Partial<Claim837Input> = {}): Claim837Input {
  return {
    envelope: SYNTHETIC_ENVELOPE,
    usage: "T",
    controlNumber: 1234,
    createdAt: new Date("2026-09-29T14:30:00Z"),
    billingProvider: {
      npi: "1234567893",
      lastName: "Synthprovider",
      firstName: "Avery",
      taxonomy: "207R00000X",
      tinType: "EI",
      tin: "000000001",
      addressLine1: "100 Synthetic Way",
      city: "Tampa",
      state: "FL",
      postalCode: "336020001",
    },
    subscriber: {
      memberId: "SYN123456789",
      lastName: "Synthpatient",
      firstName: "Jane",
      birthDate: "1980-01-15",
      sex: "F",
      addressLine1: "200 Synthetic Way",
      city: "Tampa",
      state: "FL",
      postalCode: "33602",
    },
    payer: { name: "Synthetic Payer", ediPayerId: "SYNTH01", regime: "fl_insurer" },
    claim: {
      claimNumber: "SYN-CLM-0001",
      serviceDate: "2026-09-01",
      diagnosisCodes: ["E11.9", "I10"],
      totalCents: 15_500,
      placeOfService: "11",
      lines: [
        {
          lineNumber: 1,
          procedureCode: "99213",
          modifiers: ["25"],
          units: 1,
          chargeCents: 12_500,
          diagnosisPointers: [1, 2],
        },
        {
          lineNumber: 2,
          procedureCode: "36415",
          modifiers: [],
          units: 1,
          chargeCents: 3_000,
          diagnosisPointers: [1],
        },
      ],
    },
    ...overrides,
  };
}
