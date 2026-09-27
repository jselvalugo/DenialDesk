import { describe, expect, it } from "vitest";
import { isSameOrigin } from "./same-origin";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/some/route", { method: "POST", headers });
}

describe("isSameOrigin", () => {
  it("trusts Sec-Fetch-Site: same-origin, even when Origin is the literal string 'null'", () => {
    // This is the real-world case that broke Insight's "Download Excel" (a full-page form POST):
    // this app's own Referrer-Policy: no-referrer makes Chromium send a literal `Origin: null`
    // for a same-origin top-level form navigation, which `new URL("null")` can't parse as a host
    // to compare — Sec-Fetch-Site is unaffected by that policy and must be checked first.
    expect(isSameOrigin(req({ "sec-fetch-site": "same-origin", origin: "null", host: "localhost" }))).toBe(
      true,
    );
  });

  it("trusts Sec-Fetch-Site: none (a direct, browser-initiated navigation)", () => {
    expect(isSameOrigin(req({ "sec-fetch-site": "none" }))).toBe(true);
  });

  it("rejects Sec-Fetch-Site: cross-site regardless of Origin", () => {
    expect(
      isSameOrigin(req({ "sec-fetch-site": "cross-site", origin: "http://localhost", host: "localhost" })),
    ).toBe(false);
  });

  it("rejects Sec-Fetch-Site: same-site (a related but different site, e.g. a subdomain)", () => {
    expect(isSameOrigin(req({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("falls back to Origin vs. Host when Sec-Fetch-Site is absent", () => {
    expect(isSameOrigin(req({ origin: "http://localhost", host: "localhost" }))).toBe(true);
    expect(isSameOrigin(req({ origin: "https://evil.example", host: "localhost" }))).toBe(false);
  });

  it("lets a request through when neither Sec-Fetch-Site nor Origin is present (old browsers; SameSite=Lax still protects the cookie)", () => {
    expect(isSameOrigin(req({}))).toBe(true);
  });

  it("rejects a literal Origin: null with no Sec-Fetch-Site to corroborate it", () => {
    expect(isSameOrigin(req({ origin: "null", host: "localhost" }))).toBe(false);
  });
});
