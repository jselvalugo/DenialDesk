import { describe, expect, it } from "vitest";
import { mrnShapeProblem } from "./mrn-shapes";

// docs/specs/patient-integrations.md PI2b: SSN- and MBI-shaped MRN values are refused at ingest,
// whatever the identifier system (security review M-1; threat model I5). Every value below is made up.

const strict = { nineDigitsVerified: false };
const verified = { nineDigitsVerified: true };

describe("mrnShapeProblem — SSN shapes", () => {
  it.each(["123-45-6789", "123 45 6789", "000-00-0000", "MRN-123-45-6789", "123-45-6789X"])(
    "refuses the dashed or spaced SSN shape %s, verified or not",
    (value) => {
      expect(mrnShapeProblem(value, strict)).toBe("mrn_looks_like_ssn");
      expect(mrnShapeProblem(value, verified)).toBe("mrn_looks_like_ssn");
    },
  );

  it("refuses a bare nine-digit value unless the operator recorded that MRNs are nine digits", () => {
    expect(mrnShapeProblem("123456789", strict)).toBe("mrn_looks_like_ssn");
    expect(mrnShapeProblem("123456789", verified)).toBeNull();
  });

  it("judges a synthetic `SYN-` marker by what follows it", () => {
    expect(mrnShapeProblem("SYN-123-45-6789", strict)).toBe("mrn_looks_like_ssn");
    expect(mrnShapeProblem("SYN-123456789", strict)).toBe("mrn_looks_like_ssn");
    expect(mrnShapeProblem("SYN-123456789", verified)).toBeNull();
    expect(mrnShapeProblem("syn_123-45-6789", strict)).toBe("mrn_looks_like_ssn");
  });

  it.each(["0012345", "SYN-0000012", "A1234567", "12345678", "1234567890", "1234-56-7890"])(
    "allows the ordinary MRN %s",
    (value) => {
      expect(mrnShapeProblem(value, strict)).toBeNull();
    },
  );

  it("does not treat digits inside a longer run as an SSN", () => {
    expect(mrnShapeProblem("9123-45-67890", strict)).toBeNull();
  });
});

describe("mrnShapeProblem — MBI shapes (CMS format, ⚠️ VERIFY)", () => {
  // Made-up values in the MBI format: digit 1-9, letter, alphanumeric, digit, letter, alphanumeric,
  // digit, letter, letter, digit, digit; the letters S L O I B Z are never used.
  it.each(["1EG4TE5MK73", "1EG4-TE5-MK73", "1eg4te5mk73", "9A00A00AA00", "SYN-1EG4TE5MK73"])(
    "refuses %s",
    (value) => {
      expect(mrnShapeProblem(value, strict)).toBe("mrn_looks_like_mbi");
      expect(mrnShapeProblem(value, verified)).toBe("mrn_looks_like_mbi");
    },
  );

  it.each([
    "0EG4TE5MK73", // position 1 may not be 0
    "1SG4TE5MK73", // S is never used
    "1EG4TE5MK7", // too short
    "1EG4TE5MK733", // too long
    "1EG4TE5M373", // position 9 must be a letter
    "SYN-0000001",
  ])("allows %s, which is not in the MBI format", (value) => {
    expect(mrnShapeProblem(value, strict)).toBeNull();
  });
});

describe("mrnShapeProblem — separators and position (security review M2)", () => {
  it.each(["123.45.6789", "123_45_6789", "123/45/6789", "123 45-6789", "MRN:123.45.6789", "A123 45 6789Z"])(
    "refuses the SSN grouped 3-2-4 with any separator: %s",
    (value) => {
      expect(mrnShapeProblem(value, strict)).toBe("mrn_looks_like_ssn");
      expect(mrnShapeProblem(value, verified)).toBe("mrn_looks_like_ssn");
    },
  );

  it.each(["A123456789", "MRN 123456789", "123456789-01", "PT123456789X"])(
    "refuses a standalone nine-digit run anywhere in the value unless verified: %s",
    (value) => {
      expect(mrnShapeProblem(value, strict)).toBe("mrn_looks_like_ssn");
      expect(mrnShapeProblem(value, verified)).toBeNull();
    },
  );

  it.each(["12345678", "1234567890", "A12345678", "12345-678901", "1234.5678"])(
    "allows digit runs that are not nine long: %s",
    (value) => {
      expect(mrnShapeProblem(value, strict)).toBeNull();
    },
  );

  it.each(["PT-1EG4TE5MK73", "1EG4TE5MK73-01", "MBI 1EG4.TE5.MK73", "x 1eg4 te5 mk73 y", "1EG4_TE5_MK73"])(
    "refuses an MBI token anywhere, compact or grouped with any separator: %s",
    (value) => {
      expect(mrnShapeProblem(value, strict)).toBe("mrn_looks_like_mbi");
      expect(mrnShapeProblem(value, verified)).toBe("mrn_looks_like_mbi");
    },
  );

  it("does not take a piece of a longer alphanumeric run for an MBI", () => {
    expect(mrnShapeProblem("A1EG4TE5MK73", strict)).toBeNull();
    expect(mrnShapeProblem("1EG4TE5MK73B", strict)).toBeNull();
  });
});

describe("mrnShapeProblem — partly grouped identifiers (security review Low)", () => {
  it.each(["123-456789", "12345-6789", "123--45--6789", "12-345-6789"])(
    "refuses the nine digits hidden by separators in %s unless verified",
    (value) => {
      expect(mrnShapeProblem(value, strict)).toBe("mrn_looks_like_ssn");
    },
  );

  it.each(["123-456789", "12345-6789"])(
    "%s is allowed once the operator recorded nine-digit MRNs",
    (value) => {
      expect(mrnShapeProblem(value, verified)).toBeNull();
    },
  );

  it("refuses 123--45--6789 always: stripped or not, it is the 3-2-4 SSN shape", () => {
    expect(mrnShapeProblem("123--45--6789", verified)).toBe("mrn_looks_like_ssn");
  });

  it.each(["1EG4TE5-MK73", "1EG4-TE5MK73"])(
    "refuses the MBI %s split at odd places, verified or not",
    (value) => {
      expect(mrnShapeProblem(value, strict)).toBe("mrn_looks_like_mbi");
      expect(mrnShapeProblem(value, verified)).toBe("mrn_looks_like_mbi");
    },
  );

  it("still allows ordinary synthetic MRNs", () => {
    for (const value of ["SYN-0000001", "SYN-0000123", "1234-56-7890"]) {
      expect(mrnShapeProblem(value, strict)).toBeNull();
    }
  });
});
