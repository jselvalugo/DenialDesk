import { describe, expect, it } from "vitest";
import { TransportError } from "./errors";
import {
  assertBundleEntryLimit,
  assertNextIsSameOrigin,
  DEFAULT_RUN_BUDGET,
  MAX_BUNDLE_ENTRIES,
  PagingLoopGuard,
  RunBudget,
} from "./limits";

describe("assertBundleEntryLimit", () => {
  it("allows exactly the cap", () => {
    expect(() => assertBundleEntryLimit(MAX_BUNDLE_ENTRIES)).not.toThrow();
  });
  it("refuses one over the cap", () => {
    expect(() => assertBundleEntryLimit(MAX_BUNDLE_ENTRIES + 1)).toThrow(TransportError);
    try {
      assertBundleEntryLimit(MAX_BUNDLE_ENTRIES + 1);
    } catch (error) {
      expect((error as TransportError).code).toBe("too_large");
    }
  });
  it("honors a custom max", () => {
    expect(() => assertBundleEntryLimit(11, 10)).toThrow(TransportError);
    expect(() => assertBundleEntryLimit(10, 10)).not.toThrow();
  });
});

describe("RunBudget", () => {
  it("has the spec's defaults: 12 min, 5,000 requests, 500 MB", () => {
    expect(DEFAULT_RUN_BUDGET.wallClockMs).toBe(12 * 60 * 1000);
    expect(DEFAULT_RUN_BUDGET.maxRequests).toBe(5_000);
    expect(DEFAULT_RUN_BUDGET.maxBytes).toBe(500 * 1024 * 1024);
  });

  it("allows the first request and tracks usage", () => {
    const budget = new RunBudget();
    expect(() => budget.assertCanStartRequest()).not.toThrow();
    budget.recordRequest(1024);
    expect(budget.requestsMade).toBe(1);
    expect(budget.bytesTransferred).toBe(1024);
  });

  it("refuses once the wall-clock budget is exceeded (day-of / day-after style boundary)", () => {
    let now = 0;
    const budget = new RunBudget({ wallClockMs: 1_000, maxRequests: 100, maxBytes: 100 }, () => now);
    now = 999;
    expect(() => budget.assertCanStartRequest()).not.toThrow(); // just under
    now = 1_001;
    expect(() => budget.assertCanStartRequest()).toThrow(TransportError);
    try {
      budget.assertCanStartRequest();
    } catch (error) {
      expect((error as TransportError).code).toBe("timeout");
    }
  });

  it("refuses once the request-count budget is exhausted", () => {
    const budget = new RunBudget({ wallClockMs: 60_000, maxRequests: 2, maxBytes: 10_000 });
    budget.recordRequest(1);
    expect(() => budget.assertCanStartRequest()).not.toThrow();
    budget.recordRequest(1);
    expect(() => budget.assertCanStartRequest()).toThrow(TransportError);
    try {
      budget.assertCanStartRequest();
    } catch (error) {
      expect((error as TransportError).code).toBe("too_large");
    }
  });

  it("refuses once the byte budget is exhausted", () => {
    const budget = new RunBudget({ wallClockMs: 60_000, maxRequests: 100, maxBytes: 100 });
    budget.recordRequest(100);
    expect(() => budget.assertCanStartRequest()).toThrow(TransportError);
  });
});

describe("PagingLoopGuard", () => {
  it("allows a sequence of distinct next URLs", () => {
    const guard = new PagingLoopGuard();
    expect(() => guard.check("https://ehr.example/fhir/Patient?page=1")).not.toThrow();
    expect(() => guard.check("https://ehr.example/fhir/Patient?page=2")).not.toThrow();
    expect(() => guard.check("https://ehr.example/fhir/Patient?page=3")).not.toThrow();
  });

  it("refuses a repeated next URL", () => {
    const guard = new PagingLoopGuard();
    guard.check("https://ehr.example/fhir/Patient?page=1");
    guard.check("https://ehr.example/fhir/Patient?page=2");
    expect(() => guard.check("https://ehr.example/fhir/Patient?page=1")).toThrow(TransportError);
    try {
      guard.check("https://ehr.example/fhir/Patient?page=1");
    } catch (error) {
      expect((error as TransportError).code).toBe("paging_loop");
    }
  });

  it("never stores the raw URL text (only a hash)", () => {
    const guard = new PagingLoopGuard();
    guard.check("https://ehr.example/fhir/Patient?_token=SECRET123");
    const internals = guard as unknown as { seen: Set<string> };
    for (const stored of internals.seen) {
      expect(stored).not.toContain("SECRET123");
      expect(stored).not.toContain("ehr.example");
    }
  });
});

describe("assertNextIsSameOrigin", () => {
  const base = new URL("https://ehr.example/fhir/r4");

  it("allows a next URL on the same origin, any path or query", () => {
    expect(() =>
      assertNextIsSameOrigin(base, new URL("https://ehr.example/fhir/r4/Patient?page=2")),
    ).not.toThrow();
  });

  it("refuses a different host", () => {
    expect(() => assertNextIsSameOrigin(base, new URL("https://attacker.example/fhir/r4"))).toThrow(
      TransportError,
    );
  });

  it("refuses a different scheme", () => {
    expect(() => assertNextIsSameOrigin(base, new URL("http://ehr.example/fhir/r4"))).toThrow(TransportError);
  });

  it("refuses a different port", () => {
    expect(() => assertNextIsSameOrigin(base, new URL("https://ehr.example:8443/fhir/r4"))).toThrow(
      TransportError,
    );
  });

  it("carries the address_refused code", () => {
    try {
      assertNextIsSameOrigin(base, new URL("https://attacker.example/fhir/r4"));
    } catch (error) {
      expect((error as TransportError).code).toBe("address_refused");
    }
  });
});
