import { describe, expect, it } from "vitest";
import { retryAfterSecondsOf } from "./transport";

// RFC 9110 §10.2.3: Retry-After is delta-seconds or an HTTP-date. PI2b's backoff honors it up to 60 s;
// the transport reads it from an error response (and nothing else from it).
describe("retryAfterSecondsOf", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");

  it("reads delta-seconds", () => {
    expect(retryAfterSecondsOf("0", now)).toBe(0);
    expect(retryAfterSecondsOf("120", now)).toBe(120);
    expect(retryAfterSecondsOf([" 5 "], now)).toBe(5);
  });

  it("reads an HTTP-date against the given clock, never negative", () => {
    expect(retryAfterSecondsOf("Mon, 28 Sep 2026 12:00:30 GMT", now)).toBe(30);
    expect(retryAfterSecondsOf("Mon, 28 Sep 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("caps at a day and ignores anything else", () => {
    expect(retryAfterSecondsOf("999999999", now)).toBe(86_400);
    for (const bad of [
      undefined,
      "",
      "soon",
      "-5",
      "1.5",
      "12abc",
      "2026-09-28T12:00:30Z",
      "1234567890123",
    ]) {
      expect(retryAfterSecondsOf(bad, now)).toBeUndefined();
    }
  });
});
