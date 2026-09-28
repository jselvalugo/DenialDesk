import { describe, expect, it } from "vitest";
import { en } from "@/i18n/messages/en";
import { es } from "@/i18n/messages/es";
import { pt } from "@/i18n/messages/pt";
import { jwksPathFor } from "./approval";
import {
  APPROVAL_METHOD_CODES,
  APPROVAL_METHOD_LABEL_KEYS,
  CONTACT_ROLE_CODES,
  CONTACT_ROLE_LABEL_KEYS,
  isApprovalMethodCode,
  isContactRoleCode,
  isPopulationScope,
  isRejectReasonCode,
  POPULATION_SCOPE_LABEL_KEYS,
  POPULATION_SCOPES,
  REJECT_REASON_CODES,
  REJECT_REASON_LABEL_KEYS,
} from "./approval-codes";

// Pure parts of operator approval (docs/specs/patient-integrations.md PI1c); the decisions
// themselves run against the database in test/integration/integration-approval*.test.ts.

const dictionaries = [
  ["en", en],
  ["es", es],
  ["pt", pt],
] as const;

describe("the approval vocabularies are fixed codes", () => {
  it("fit the status_reason CHECK (^[a-z_]{1,64}$), which stores a reject code", () => {
    for (const code of [
      ...APPROVAL_METHOD_CODES,
      ...CONTACT_ROLE_CODES,
      ...POPULATION_SCOPES,
      ...REJECT_REASON_CODES,
    ]) {
      expect(code).toMatch(/^[a-z_]{1,64}$/);
    }
  });

  it("population scopes are exactly the two the database allows", () => {
    expect([...POPULATION_SCOPES]).toEqual(["group_export", "verified_filter"]);
  });

  it.each([
    ["approval method", isApprovalMethodCode, APPROVAL_METHOD_CODES],
    ["contact role", isContactRoleCode, CONTACT_ROLE_CODES],
    ["population scope", isPopulationScope, POPULATION_SCOPES],
    ["reject reason", isRejectReasonCode, REJECT_REASON_CODES],
  ] as const)("accept every %s code and nothing else", (_name, is, codes) => {
    for (const code of codes) expect(is(code)).toBe(true);
    for (const value of [
      "",
      " ",
      "Patient Synthetic Person",
      codes[0].toUpperCase(),
      `${codes[0]} `,
      null,
      undefined,
      3,
      {},
      [codes[0]],
    ]) {
      expect(is(value)).toBe(false);
    }
  });
});

describe("labels", () => {
  it("every approval method, contact role, and population scope has a label in English, Spanish, and Portuguese", () => {
    for (const [language, dictionary] of dictionaries) {
      for (const key of [
        ...Object.values(APPROVAL_METHOD_LABEL_KEYS),
        ...Object.values(CONTACT_ROLE_LABEL_KEYS),
        ...Object.values(POPULATION_SCOPE_LABEL_KEYS),
      ]) {
        expect(dictionary.operator[key], `${language} ${key}`).toBeTruthy();
      }
    }
  });

  it("every reject reason has a label the practice can read, in every language", () => {
    for (const [language, dictionary] of dictionaries) {
      for (const key of Object.values(REJECT_REASON_LABEL_KEYS)) {
        expect(dictionary.integrations[key], `${language} ${key}`).toBeTruthy();
      }
    }
  });

  it("the operator's screens, refusals, and the practice's rejection notice exist in every language", () => {
    const operatorKeys = Object.keys(en.operator).filter(
      (key) => key.startsWith("integrations.") || /^errors\.(integration|approval|reject)/.test(key),
    ) as (keyof typeof en.operator)[];
    expect(operatorKeys.length).toBeGreaterThan(40);
    for (const [language, dictionary] of dictionaries) {
      for (const key of operatorKeys) expect(dictionary.operator[key], `${language} ${key}`).toBeTruthy();
      expect(dictionary.integrations["rejected.notice"], language).toContain("{reason}");
    }
  });

  it("the ownership confirmation names the client ID it is about, in every language", () => {
    for (const [language, dictionary] of dictionaries) {
      expect(dictionary.operator["integrations.approve.ownershipLabel"], language).toContain("{clientId}");
    }
    expect(en.operator["integrations.approve.ownershipLabel"]).toBe(
      "I verified, outside DenialDesk, that this practice owns client ID {clientId}",
    );
  });

  it("the spec's optional confirmation reads 'MRNs are 9 digits (verified)'", () => {
    expect(en.operator["integrations.approve.nineDigitsLabel"]).toBe("MRNs are 9 digits (verified)");
  });
});

describe("jwksPathFor", () => {
  const id = "3f1c0f88-6f6a-4a55-9a53-0c1f9d6f9d11";

  it("is the one shared key's document where only synthetic data is allowed", () => {
    expect(jwksPathFor(id, true)).toBe("/.well-known/jwks.json");
  });

  it("is a per-connection document where real data is allowed", () => {
    expect(jwksPathFor(id, false)).toBe(`/.well-known/jwks/${id}.json`);
  });
});
