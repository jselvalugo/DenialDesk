// Minimal, defensive X12 835 (005010X221A1) parser and synthetic builder.
//
// Scope: enough of the Health Care Claim Payment/Advice transaction to post
// remittances and reconcile against submitted claims (R-8.2 step 7,
// R-3.1.1 prompt-pay evidence). Anything not modeled here (bank account
// details, subscriber/patient names, secondary identifiers beyond what is
// listed below) is intentionally NOT read or stored (minimum necessary).
//
// Every inbound file is untrusted (R-7.4.6): structure is validated before
// any value is trusted, and error messages never include patient names or
// member IDs — only segment positions and claim numbers (CLP01), which are
// not patient identifiers.

import { tokenize, type Segment } from "./segments";

export class Edi835Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Edi835Error";
  }
}

export type PaymentMethod = "check" | "eft" | "non_payment";

export interface Adjustment835 {
  group: "CO" | "PR" | "OA" | "PI";
  carc: string;
  cents: number;
}

export interface Claim835 {
  claimNumber: string;
  statusCode: string;
  chargeCents: number;
  paidCents: number;
  patientResponsibilityCents: number;
  payerControlNumber: string | null;
  adjustments: Adjustment835[];
  rarcs: string[];
}

export interface Remittance835 {
  payment: {
    method: PaymentMethod;
    totalPaidCents: number;
    paymentDate: string;
    traceNumber: string;
  };
  payer: {
    name: string;
    ediPayerId: string | null;
  };
  claims: Claim835[];
}

const ADJUSTMENT_GROUPS = new Set(["CO", "PR", "OA", "PI"]);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function parseAmountToCents(raw: string, context: string): number {
  if (!/^-?\d+(\.\d{1,2})?$/.test(raw)) {
    throw new Edi835Error(`invalid monetary amount in ${context}`);
  }
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [dollarsStr, fracStrRaw] = unsigned.split(".") as [string, string | undefined];
  const fracStr = (fracStrRaw ?? "").padEnd(2, "0");
  const cents = parseInt(dollarsStr, 10) * 100 + parseInt(fracStr, 10);
  return negative ? -cents : cents;
}

function centsToAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const rem = abs % 100;
  return `${sign}${dollars}.${String(rem).padStart(2, "0")}`;
}

function parseDateCcyymmdd(raw: string, context: string): string {
  if (!/^\d{8}$/.test(raw)) {
    throw new Edi835Error(`invalid date in ${context}`);
  }
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Edi835Error(`invalid date in ${context}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isoToCcyymmdd(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    throw new Edi835Error("invalid payment date: expected YYYY-MM-DD");
  }
  return `${match[1]}${match[2]}${match[3]}`;
}

function elementOrNull(elements: string[], index: number): string | null {
  const v = elements[index];
  return v === undefined || v === "" ? null : v;
}

function addAdjustment(map: Map<string, Adjustment835>, group: string, carc: string, cents: number): void {
  const key = `${group}|${carc}`;
  const existing = map.get(key);
  if (existing) {
    existing.cents += cents;
  } else {
    map.set(key, { group: group as Adjustment835["group"], carc, cents });
  }
}

function addRarc(list: string[], seen: Set<string>, code: string): void {
  if (!code) return;
  if (seen.has(code)) return;
  seen.add(code);
  list.push(code);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export function parse835(text: string): Remittance835 {
  let segments: ReturnType<typeof tokenize>["segments"];
  try {
    ({ segments } = tokenize(text));
  } catch (error) {
    // Tokenizer problems (size, short ISA) are file problems the uploader can fix.
    throw new Edi835Error(error instanceof Error ? error.message : "The file isn't a readable X12 file.");
  }

  const stSegments835 = segments.filter((s) => s.id === "ST" && s.elements[0] === "835");
  if (stSegments835.length !== 1) {
    throw new Edi835Error(
      `one remittance per file: expected exactly one ST*835 transaction set, found ${stSegments835.length}`,
    );
  }
  const st = stSegments835[0] as Segment;
  const stIndex = segments.indexOf(st);

  let seIndex = -1;
  for (let i = stIndex + 1; i < segments.length; i++) {
    if (segments[i]?.id === "SE") {
      seIndex = i;
      break;
    }
  }
  if (seIndex === -1) {
    throw new Edi835Error(`segment ${st.position} (ST): no matching SE segment found`);
  }

  const body = segments.slice(stIndex + 1, seIndex);

  let bprSeg: Segment | undefined;
  let trnSeg: Segment | undefined;
  let payerN1: Segment | undefined;
  let ref2u: Segment | undefined;

  const claims: Claim835[] = [];
  const plbAmounts: number[] = [];

  let currentClaim: Claim835 | null = null;
  let currentAdjustments: Map<string, Adjustment835> | null = null;
  let currentRarcs: string[] = [];
  let currentRarcSeen: Set<string> = new Set();
  let inPlb = false;

  function flushClaim(): void {
    if (currentClaim && currentAdjustments) {
      currentClaim.adjustments = Array.from(currentAdjustments.values());
      currentClaim.rarcs = currentRarcs;
      claims.push(currentClaim);
    }
    currentClaim = null;
    currentAdjustments = null;
    currentRarcs = [];
    currentRarcSeen = new Set();
  }

  for (const seg of body) {
    switch (seg.id) {
      case "BPR": {
        if (!bprSeg) bprSeg = seg;
        break;
      }
      case "TRN": {
        if (!trnSeg) trnSeg = seg;
        break;
      }
      case "N1": {
        if (seg.elements[0] === "PR" && !payerN1) {
          payerN1 = seg;
        }
        break;
      }
      case "REF": {
        if (seg.elements[0] === "2U" && !ref2u && !currentClaim) {
          ref2u = seg;
        }
        break;
      }
      case "NM1": {
        // NM1*QC (patient) / NM1*IL (subscriber): never read, never stored.
        break;
      }
      case "PLB": {
        flushClaim();
        inPlb = true;
        const pairs = seg.elements.slice(2);
        for (let i = 0; i + 1 < pairs.length; i += 2) {
          const amountRaw = pairs[i + 1];
          if (amountRaw === undefined || amountRaw === "") continue;
          plbAmounts.push(parseAmountToCents(amountRaw, `segment ${seg.position} (PLB)`));
        }
        break;
      }
      case "CLP": {
        if (inPlb) {
          throw new Edi835Error(
            `segment ${seg.position} (CLP): claim segment found after PLB provider adjustments`,
          );
        }
        flushClaim();
        const claimNumber = seg.elements[0] ?? "";
        const statusCode = seg.elements[1] ?? "";
        if (!claimNumber) {
          throw new Edi835Error(`segment ${seg.position} (CLP): missing claim number (CLP01)`);
        }
        const chargeCents = parseAmountToCents(
          seg.elements[2] ?? "",
          `segment ${seg.position} (CLP) claim ${claimNumber} charge`,
        );
        const paidCents = parseAmountToCents(
          seg.elements[3] ?? "",
          `segment ${seg.position} (CLP) claim ${claimNumber} paid amount`,
        );
        const patRespRaw = seg.elements[4];
        const patientResponsibilityCents =
          patRespRaw === undefined || patRespRaw === ""
            ? 0
            : parseAmountToCents(
                patRespRaw,
                `segment ${seg.position} (CLP) claim ${claimNumber} patient responsibility`,
              );
        const payerControlNumber = elementOrNull(seg.elements, 6);

        currentClaim = {
          claimNumber,
          statusCode,
          chargeCents,
          paidCents,
          patientResponsibilityCents,
          payerControlNumber,
          adjustments: [],
          rarcs: [],
        };
        currentAdjustments = new Map();
        currentRarcs = [];
        currentRarcSeen = new Set();
        break;
      }
      case "CAS": {
        if (!currentAdjustments || !currentClaim) {
          throw new Edi835Error(`segment ${seg.position} (CAS): appears outside of a CLP claim loop`);
        }
        const group = seg.elements[0];
        if (!group || !ADJUSTMENT_GROUPS.has(group)) {
          throw new Edi835Error(
            `segment ${seg.position} (CAS) claim ${currentClaim.claimNumber}: unknown or missing adjustment group code`,
          );
        }
        const triplets = seg.elements.slice(1);
        // Up to 6 (reason, amount, quantity) triplets per CAS segment.
        for (let i = 0; i < triplets.length && i < 18; i += 3) {
          const carc = triplets[i];
          const amountRaw = triplets[i + 1];
          if (!carc && amountRaw === undefined) break;
          if (!carc || amountRaw === undefined || amountRaw === "") {
            throw new Edi835Error(
              `segment ${seg.position} (CAS) claim ${currentClaim.claimNumber}: incomplete adjustment triplet`,
            );
          }
          const cents = parseAmountToCents(
            amountRaw,
            `segment ${seg.position} (CAS) claim ${currentClaim.claimNumber} adjustment`,
          );
          addAdjustment(currentAdjustments, group, carc, cents);
        }
        break;
      }
      case "MOA": {
        // MOA03-MOA07: up to 5 claim payment remark codes.
        if (currentClaim) {
          for (let i = 2; i <= 6; i++) {
            const code = seg.elements[i];
            if (code) addRarc(currentRarcs, currentRarcSeen, code);
          }
        }
        break;
      }
      case "MIA": {
        // MIA08-MIA13: up to 6 claim payment remark codes (inpatient).
        if (currentClaim) {
          for (let i = 7; i <= 12; i++) {
            const code = seg.elements[i];
            if (code) addRarc(currentRarcs, currentRarcSeen, code);
          }
        }
        break;
      }
      case "LQ": {
        if (currentClaim && seg.elements[0] === "HE") {
          const code = seg.elements[1];
          if (code) addRarc(currentRarcs, currentRarcSeen, code);
        }
        break;
      }
      default:
        // SVC, DTM, AMT, LX, and any other segment types are not needed
        // for reconciliation and are intentionally ignored.
        break;
    }
  }
  flushClaim();

  if (!bprSeg) throw new Edi835Error("missing required BPR (financial information) segment");
  if (!trnSeg) throw new Edi835Error("missing required TRN (reassociation trace) segment");
  if (!payerN1) throw new Edi835Error("missing required N1*PR (payer) segment");
  if (claims.length === 0) throw new Edi835Error("no CLP claim payment segments found");

  const bpr01 = bprSeg.elements[0];
  const bpr02Raw = bprSeg.elements[1];
  const bpr04 = bprSeg.elements[3];
  const bpr16 = bprSeg.elements[15];

  if (!bpr02Raw) {
    throw new Edi835Error(`segment ${bprSeg.position} (BPR): missing total payment amount (BPR02)`);
  }
  const totalPaidCents = parseAmountToCents(
    bpr02Raw,
    `segment ${bprSeg.position} (BPR) total payment amount`,
  );

  let method: PaymentMethod;
  if (bpr01 === "H" || bpr04 === "NON") {
    method = "non_payment";
  } else if (bpr01 === "C" || bpr01 === "I") {
    if (bpr04 === "CHK") method = "check";
    else if (bpr04 === "ACH" || bpr04 === "FWT" || bpr04 === "BOP") method = "eft";
    else throw new Edi835Error(`segment ${bprSeg.position} (BPR): unsupported payment method code`);
  } else {
    throw new Edi835Error(`segment ${bprSeg.position} (BPR): unsupported transaction handling code`);
  }

  if (!bpr16) {
    throw new Edi835Error(`segment ${bprSeg.position} (BPR): missing payment date (BPR16)`);
  }
  const paymentDate = parseDateCcyymmdd(bpr16, `segment ${bprSeg.position} (BPR) payment date`);

  const traceNumber = trnSeg.elements[1] ?? "";
  if (!traceNumber) {
    throw new Edi835Error(`segment ${trnSeg.position} (TRN): missing trace number (TRN02)`);
  }

  const payerName = payerN1.elements[1] ?? "";
  const n103 = payerN1.elements[2];
  const n104 = payerN1.elements[3];
  let ediPayerId: string | null = null;
  if ((n103 === "XV" || n103 === "PI") && n104) {
    ediPayerId = n104;
  } else if (ref2u?.elements[1]) {
    ediPayerId = ref2u.elements[1];
  }

  const sumClaimsPaid = claims.reduce((sum, c) => sum + c.paidCents, 0);
  const sumPlb = plbAmounts.reduce((sum, v) => sum + v, 0);
  if (sumClaimsPaid - sumPlb !== totalPaidCents) {
    throw new Edi835Error(
      `remittance does not balance: sum(CLP04)=${sumClaimsPaid} - sum(PLB)=${sumPlb} != BPR02=${totalPaidCents}`,
    );
  }

  return {
    payment: { method, totalPaidCents, paymentDate, traceNumber },
    payer: { name: payerName, ediPayerId },
    claims,
  };
}

// ---------------------------------------------------------------------------
// Building (synthetic data only — used for fixtures and tests, R-1)
// ---------------------------------------------------------------------------

function methodToBprCodes(method: PaymentMethod): { bpr01: string; bpr04: string } {
  switch (method) {
    case "check":
      return { bpr01: "C", bpr04: "CHK" };
    case "eft":
      return { bpr01: "C", bpr04: "ACH" };
    case "non_payment":
      return { bpr01: "H", bpr04: "NON" };
  }
}

export function build835(remit: Remittance835, options?: { controlNumber?: string }): string {
  const controlNumber = options?.controlNumber ?? "000000001";
  const isaControlNumber = controlNumber.padStart(9, "0").slice(-9);
  const gsControlNumber = controlNumber.padStart(9, "0").slice(-9);
  const stControlNumber = "0001";

  const EL = "*";
  const SEG = "~";
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(2);
  const isaDate = `${yy}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const gsDate = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const time = `${String(now.getUTCHours()).padStart(2, "0")}${String(now.getUTCMinutes()).padStart(2, "0")}`;

  const segments: string[] = [];

  const isa = [
    "ISA",
    "00",
    "          ",
    "00",
    "          ",
    "ZZ",
    "SYNTHETIC_SENDER".padEnd(15).slice(0, 15),
    "ZZ",
    "SYNTHETIC_RECEIVR".padEnd(15).slice(0, 15),
    isaDate,
    time,
    "^",
    "00501",
    isaControlNumber,
    "0",
    "P",
    ":",
  ].join(EL);
  segments.push(isa);

  segments.push(
    ["GS", "HP", "SYNTHSNDR", "SYNTHRCVR", gsDate, time, gsControlNumber, "X", "005010X221A1"].join(EL),
  );
  const stIndex = segments.length;
  segments.push(["ST", "835", stControlNumber, "005010X221A1"].join(EL));

  const { bpr01, bpr04 } = methodToBprCodes(remit.payment.method);
  const bprDate = isoToCcyymmdd(remit.payment.paymentDate);
  segments.push(
    [
      "BPR",
      bpr01,
      centsToAmount(remit.payment.totalPaidCents),
      "C",
      bpr04,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      bprDate,
    ].join(EL),
  );

  segments.push(["TRN", "1", remit.payment.traceNumber, "1999999999"].join(EL));
  segments.push(["DTM", "405", bprDate].join(EL));

  if (remit.payer.ediPayerId) {
    segments.push(["N1", "PR", remit.payer.name, "PI", remit.payer.ediPayerId].join(EL));
  } else {
    segments.push(["N1", "PR", remit.payer.name].join(EL));
  }
  segments.push(["N1", "PE", "SYNTHETIC PROVIDER", "XX", "1999999999"].join(EL));

  segments.push(["LX", "1"].join(EL));

  for (const claim of remit.claims) {
    segments.push(
      [
        "CLP",
        claim.claimNumber,
        claim.statusCode,
        centsToAmount(claim.chargeCents),
        centsToAmount(claim.paidCents),
        centsToAmount(claim.patientResponsibilityCents),
        "",
        claim.payerControlNumber ?? "",
      ].join(EL),
    );

    // Group merged adjustments back into CAS segments, up to 6 triplets each.
    const byGroup = new Map<string, Adjustment835[]>();
    for (const adj of claim.adjustments) {
      const list = byGroup.get(adj.group) ?? [];
      list.push(adj);
      byGroup.set(adj.group, list);
    }
    for (const [group, adjustments] of byGroup) {
      for (let i = 0; i < adjustments.length; i += 6) {
        const chunk = adjustments.slice(i, i + 6);
        const fields = [group];
        for (const adj of chunk) {
          fields.push(adj.carc, centsToAmount(adj.cents), "");
        }
        segments.push(["CAS", ...fields].join(EL));
      }
    }

    if (claim.rarcs.length > 0) {
      const moaCodes = claim.rarcs.slice(0, 5);
      const moaFields = ["MOA", "", "", ...moaCodes];
      segments.push(moaFields.join(EL));
      for (const code of claim.rarcs.slice(5)) {
        segments.push(["LQ", "HE", code].join(EL));
      }
    }
  }

  const seSegmentCount = segments.length - stIndex + 1;
  segments.push(["SE", String(seSegmentCount), stControlNumber].join(EL));
  segments.push(["GE", "1", gsControlNumber].join(EL));
  segments.push(["IEA", "1", isaControlNumber].join(EL));

  return segments.join(SEG) + SEG;
}
