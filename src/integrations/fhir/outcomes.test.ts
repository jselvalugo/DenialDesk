import { describe, expect, it } from "vitest";
import { TransportError, type TransportErrorCode } from "./errors";
import {
  CONNECTION_OUTCOMES,
  FhirConnectError,
  isFhirConnectError,
  isSecurityTransportCode,
  outcomeForStatus,
  outcomeForTransportError,
} from "./outcomes";

describe("outcome vocabulary", () => {
  it("is exactly the seven outcomes the spec lists", () => {
    expect([...CONNECTION_OUTCOMES]).toEqual([
      "ok",
      "unreachable",
      "tls_failed",
      "not_fhir_r4",
      "smart_config_invalid",
      "auth_refused",
      "capability_missing",
    ]);
  });
});

describe("security transport codes (spec: emitted as ID-only security events)", () => {
  it.each(["address_refused", "tls_failed", "redirect_refused"] as const)(
    "%s is a security event",
    (code) => {
      expect(isSecurityTransportCode(code)).toBe(true);
    },
  );
  it.each(["unreachable", "timeout", "too_large", "content_type_refused", "paging_loop"] as const)(
    "%s is not",
    (code) => {
      expect(isSecurityTransportCode(code)).toBe(false);
    },
  );
  it("undefined is not", () => {
    expect(isSecurityTransportCode(undefined)).toBe(false);
  });
});

describe("outcomeForTransportError", () => {
  it("rethrows an error that isn't a TransportError", () => {
    const bug = new TypeError("bug");
    expect(() => outcomeForTransportError(bug, "not_fhir_r4")).toThrow(bug);
  });

  it("maps every transport code to an outcome without repeating the transport's message", () => {
    const codes: TransportErrorCode[] = [
      "unreachable",
      "tls_failed",
      "address_refused",
      "redirect_refused",
      "content_type_refused",
      "too_large",
      "timeout",
      "paging_loop",
    ];
    for (const code of codes) {
      const mapped = outcomeForTransportError(
        new TransportError(code, "https://secret.host/path?x=1"),
        "not_fhir_r4",
      );
      expect(isFhirConnectError(mapped)).toBe(true);
      expect(mapped.message).toBe(mapped.outcome);
      expect(mapped.message).not.toContain("secret");
      expect(mapped.transportCode).toBe(code);
    }
  });
});

describe("outcomeForStatus", () => {
  it("401 and 403 are auth_refused whatever the fallback", () => {
    expect(outcomeForStatus(401, "not_fhir_r4").outcome).toBe("auth_refused");
    expect(outcomeForStatus(403, "smart_config_invalid").outcome).toBe("auth_refused");
  });
  it("408, 425, 429 and 5xx are unreachable", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(outcomeForStatus(status, "not_fhir_r4").outcome).toBe("unreachable");
    }
  });
  it("anything else is the fallback", () => {
    for (const status of [400, 404, 410, 422, 204, 100]) {
      expect(outcomeForStatus(status, "smart_config_invalid").outcome).toBe("smart_config_invalid");
    }
  });
  it("is a FhirConnectError with no transport code", () => {
    const error = outcomeForStatus(500, "not_fhir_r4");
    expect(error).toBeInstanceOf(FhirConnectError);
    expect(error.transportCode).toBeUndefined();
  });
});
