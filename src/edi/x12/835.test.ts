import { describe, expect, it } from "vitest";
import { build835, Edi835Error, parse835, type Remittance835 } from "./835";

function baseRemit(overrides?: Partial<Remittance835>): Remittance835 {
  return {
    payment: {
      method: "eft",
      totalPaidCents: 8000,
      paymentDate: "2026-01-15",
      traceNumber: "TRACE0001",
    },
    payer: { name: "SYNTHETIC PAYER", ediPayerId: "12345" },
    claims: [
      {
        claimNumber: "CLAIM0001",
        statusCode: "1",
        chargeCents: 10000,
        paidCents: 8000,
        patientResponsibilityCents: 2000,
        payerControlNumber: "PCN0001",
        adjustments: [{ group: "CO", carc: "45", cents: 2000 }],
        rarcs: ["N478"],
      },
    ],
    ...overrides,
  };
}

describe("835 build -> parse round trip", () => {
  it("round-trips a basic remittance", () => {
    const remit = baseRemit();
    const text = build835(remit);
    const parsed = parse835(text);
    expect(parsed).toEqual(remit);
  });

  it("supports custom separators declared in ISA", () => {
    const remit = baseRemit();
    const text = build835(remit);
    // Rewrite with alternate separators: element '|', terminator '\n'.
    // Replacing every '*' and '~' also rewrites the ISA's own declared
    // separators at positions 3 and 105, so the file stays self-consistent.
    const finalText = text.replace(/\*/g, "|").replace(/~/g, "\n");
    const parsed = parse835(finalText);
    expect(parsed.payment.traceNumber).toBe("TRACE0001");
    expect(parsed.claims).toHaveLength(1);
  });

  it("merges multi-triplet CAS and SVC-level CAS into claim adjustments", () => {
    const remit = baseRemit({
      claims: [
        {
          claimNumber: "CLAIM0002",
          statusCode: "2",
          chargeCents: 30000,
          paidCents: 20000,
          patientResponsibilityCents: 5000,
          payerControlNumber: null,
          adjustments: [
            { group: "CO", carc: "45", cents: 3000 },
            { group: "CO", carc: "97", cents: 2000 },
            { group: "PR", carc: "1", cents: 5000 },
          ],
          rarcs: [],
        },
      ],
      payment: { ...baseRemit().payment, totalPaidCents: 20000 },
    });
    // Build a file manually with claim-level CAS carrying 2 triplets and an
    // SVC-level CAS carrying a third triplet for the same group, to prove
    // they get merged by group+carc.
    const built = build835(remit);
    // Insert an SVC + SVC-level CAS after the CLP/CAS lines by re-parsing
    // and checking the merge behavior directly instead (build already
    // collapses same-group adjustments into one CAS segment when possible).
    const parsed = parse835(built);
    expect(parsed.claims[0]!.adjustments).toEqual(
      expect.arrayContaining([
        { group: "CO", carc: "45", cents: 3000 },
        { group: "CO", carc: "97", cents: 2000 },
        { group: "PR", carc: "1", cents: 5000 },
      ]),
    );

    // Now hand-craft raw X12 with a claim-level CAS and a separate SVC-level
    // CAS for the same group+carc, and confirm they sum.
    const raw = [
      "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260115*1200*^*00501*000000001*0*P*:~",
      "GS*HP*SENDER*RECEIVER*20260115*1200*1*X*005010X221A1~",
      "ST*835*0001*005010X221A1~",
      "BPR*C*90.00*C*ACH************20260115~",
      "TRN*1*TRACE0002*1999999999~",
      "N1*PR*SYNTHETIC PAYER*PI*12345~",
      "N1*PE*SYNTHETIC PROVIDER*XX*1999999999~",
      "LX*1~",
      "CLP*CLAIM0003*1*100.00*90.00*10.00**PCN9~",
      "CAS*CO*45*5.00~",
      "SVC*HC:99213*100.00*90.00~",
      "CAS*CO*45*5.00~",
      "SE*12*0001~",
      "GE*1*1~",
      "IEA*1*000000001~",
    ].join("");
    const parsedRaw = parse835(raw);
    expect(parsedRaw.claims[0]!.adjustments).toEqual([{ group: "CO", carc: "45", cents: 1000 }]);
  });

  it("extracts MOA and LQ*HE remark codes, de-duplicated and in order", () => {
    const raw = [
      "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260115*1200*^*00501*000000001*0*P*:~",
      "GS*HP*SENDER*RECEIVER*20260115*1200*1*X*005010X221A1~",
      "ST*835*0001*005010X221A1~",
      "BPR*C*50.00*C*ACH************20260115~",
      "TRN*1*TRACE0003*1999999999~",
      "N1*PR*SYNTHETIC PAYER*PI*12345~",
      "N1*PE*SYNTHETIC PROVIDER*XX*1999999999~",
      "LX*1~",
      "CLP*CLAIM0004*1*50.00*50.00*0.00**PCN1~",
      "MOA***N478*N479*N478~",
      "LQ*HE*N480~",
      "SE*10*0001~",
      "GE*1*1~",
      "IEA*1*000000001~",
    ].join("");
    const parsed = parse835(raw);
    expect(parsed.claims[0]!.rarcs).toEqual(["N478", "N479", "N480"]);
  });

  it("handles a reversal claim with negative paid amount", () => {
    const remit = baseRemit({
      payment: { ...baseRemit().payment, totalPaidCents: -8000 },
      claims: [
        {
          claimNumber: "CLAIM0005",
          statusCode: "22",
          chargeCents: 10000,
          paidCents: -8000,
          patientResponsibilityCents: 0,
          payerControlNumber: null,
          adjustments: [],
          rarcs: [],
        },
      ],
    });
    const text = build835(remit);
    const parsed = parse835(text);
    expect(parsed.claims[0]!.statusCode).toBe("22");
    expect(parsed.claims[0]!.paidCents).toBe(-8000);
  });

  it("balances against PLB provider-level adjustments", () => {
    const raw = [
      "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260115*1200*^*00501*000000001*0*P*:~",
      "GS*HP*SENDER*RECEIVER*20260115*1200*1*X*005010X221A1~",
      "ST*835*0001*005010X221A1~",
      "BPR*C*70.00*C*ACH************20260115~",
      "TRN*1*TRACE0004*1999999999~",
      "N1*PR*SYNTHETIC PAYER*PI*12345~",
      "N1*PE*SYNTHETIC PROVIDER*XX*1999999999~",
      "LX*1~",
      "CLP*CLAIM0006*1*100.00*100.00*0.00**PCN1~",
      "PLB*1999999999*20260115*WO:CLAIM0006*30.00~",
      "SE*11*0001~",
      "GE*1*1~",
      "IEA*1*000000001~",
    ].join("");
    const parsed = parse835(raw);
    expect(parsed.claims[0]!.paidCents).toBe(10000);
    expect(parsed.payment.totalPaidCents).toBe(7000);
  });
});

describe("835 rejection cases", () => {
  function fileWith(bpr02: string): string {
    return [
      "ISA*00*          *00*          *ZZ*SENDER         *ZZ*RECEIVER       *260115*1200*^*00501*000000001*0*P*:~",
      "GS*HP*SENDER*RECEIVER*20260115*1200*1*X*005010X221A1~",
      "ST*835*0001*005010X221A1~",
      `BPR*C*${bpr02}*C*ACH************20260115~`,
      "TRN*1*TRACE0005*1999999999~",
      "N1*PR*SYNTHETIC PAYER*PI*12345~",
      "N1*PE*SYNTHETIC PROVIDER*XX*1999999999~",
      "LX*1~",
      "CLP*CLAIM0007*1*100.00*80.00*20.00**PCN1~",
      "SE*9*0001~",
      "GE*1*1~",
      "IEA*1*000000001~",
    ].join("");
  }

  it("rejects a file with no ST*835", () => {
    const text = fileWith("80.00").replace("ST*835*0001*005010X221A1~", "");
    expect(() => parse835(text)).toThrow(Edi835Error);
    expect(() => parse835(text)).toThrow(/one remittance per file/);
  });

  it("rejects a file with two ST*835 transaction sets", () => {
    const single = fileWith("80.00");
    const doubled = single.replace(
      "SE*9*0001~",
      "SE*9*0001~ST*835*0002*005010X221A1~BPR*C*80.00*C*ACH************20260115~TRN*1*TRACE0006*1999999999~N1*PR*SYNTHETIC PAYER*PI*12345~N1*PE*SYNTHETIC PROVIDER*XX*1999999999~LX*1~CLP*CLAIM0008*1*100.00*80.00*20.00**PCN1~SE*9*0002~",
    );
    expect(() => parse835(doubled)).toThrow(/one remittance per file/);
  });

  it("rejects an unbalanced remittance", () => {
    const text = fileWith("999.00");
    expect(() => parse835(text)).toThrow(/does not balance/);
  });

  it("rejects a malformed amount", () => {
    const text = fileWith("80.00").replace(
      "CLP*CLAIM0007*1*100.00*80.00*20.00**PCN1~",
      "CLP*CLAIM0007*1*100.00*12.345*20.00**PCN1~",
    );
    expect(() => parse835(text)).toThrow(Edi835Error);
  });

  it("rejects a malformed date", () => {
    const text = fileWith("80.00").replace("20260115~", "20261399~");
    expect(() => parse835(text)).toThrow(Edi835Error);
  });

  it("rejects oversize input", () => {
    const huge = "ISA*" + "0".repeat(6 * 1024 * 1024);
    expect(() => parse835(huge)).toThrow(/exceeds maximum size/);
  });

  it("never includes patient names from NM1*QC in error messages", () => {
    const text = fileWith("999.00").replace(
      "CLP*CLAIM0007*1*100.00*80.00*20.00**PCN1~",
      "NM1*QC*1*DOE*JANE****MI*MEMBER123~CLP*CLAIM0007*1*100.00*80.00*20.00**PCN1~",
    );
    try {
      parse835(text);
      throw new Error("expected parse835 to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Edi835Error);
      const message = (err as Error).message;
      expect(message).not.toMatch(/DOE/);
      expect(message).not.toMatch(/JANE/);
      expect(message).not.toMatch(/MEMBER123/);
    }
  });
});

describe("tokenizer failures", () => {
  it("reports a truncated ISA as an Edi835Error", () => {
    expect(() => parse835("ISA*00*short~")).toThrow(Edi835Error);
  });
});
