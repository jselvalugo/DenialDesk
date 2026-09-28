import { describe, expect, it } from "vitest";
import { parseAllowedPorts, SANDBOX_BASE_URL, validateBaseUrl, type UrlRuleError } from "./url-rules";

function errorOf(raw: string, allowedPorts?: string, allowSandboxHost?: boolean): UrlRuleError | "ok" {
  const result = validateBaseUrl(raw, allowedPorts, allowSandboxHost);
  return result.ok ? "ok" : result.error;
}

describe("validateBaseUrl", () => {
  it("accepts a plain https host and path, normalizing away a trailing slash", () => {
    const result = validateBaseUrl("https://ehr.example.com/r4/");
    expect(result).toMatchObject({
      ok: true,
      normalized: "https://ehr.example.com/r4",
      endpointKey: "https://ehr.example.com/r4",
      host: "ehr.example.com",
      port: 443,
    });
  });

  it("accepts the built-in sandbox host despite the .invalid TLD, only when allowSandboxHost is set", () => {
    expect(errorOf(SANDBOX_BASE_URL, undefined, true)).toBe("ok");
  });

  it("refuses the sandbox host by default (security review PR #81: exempt only when asked)", () => {
    expect(errorOf(SANDBOX_BASE_URL)).toBe("blocked_host");
    expect(errorOf(SANDBOX_BASE_URL, undefined, false)).toBe("blocked_host");
  });

  it("lower-cases only the endpoint key, keeping the stored URL's path case", () => {
    const result = validateBaseUrl("https://EHR.Example.com/R4/Api");
    expect(result).toMatchObject({
      ok: true,
      normalized: "https://ehr.example.com/R4/Api",
      endpointKey: "https://ehr.example.com/r4/api",
    });
  });

  it.each([
    ["http://ehr.example.com/r4", "not_https"],
    ["ftp://ehr.example.com/r4", "not_https"],
    ["https://user:pass@ehr.example.com/r4", "has_userinfo"],
    ["https://ehr.example.com/r4?since=2026", "has_query"],
    ["https://ehr.example.com/r4#top", "has_fragment"],
    ["https://198.51.100.10/r4", "ip_literal"],
    ["https://[2001:db8::1]/r4", "ip_literal"],
    ["https://localhost/r4", "blocked_host"],
    ["https://foo.localhost/r4", "blocked_host"],
    ["https://ehr.local/r4", "blocked_host"],
    ["https://ehr.internal/r4", "blocked_host"],
    ["https://ehr.home.arpa/r4", "blocked_host"],
    ["https://ehr.arpa/r4", "blocked_host"],
    ["https://ehr.onion/r4", "blocked_host"],
    ["https://ehr.test/r4", "blocked_host"],
    ["https://ehr.example.example/r4", "blocked_host"],
    ["https://ehr.example.invalid/r4", "blocked_host"],
    ["https://ehr/r4", "single_label"],
    ["https://ehr.example.com./r4", "trailing_dot"],
    ["not a url", "invalid_url"],
  ] satisfies Array<[string, UrlRuleError]>)("refuses %s as %s", (raw, expected) => {
    expect(errorOf(raw)).toBe(expected);
  });

  it("allows port 443 with no configuration", () => {
    expect(errorOf("https://ehr.example.com:443/r4")).toBe("ok");
  });

  it("refuses a non-standard port with no allow-list configured", () => {
    expect(errorOf("https://ehr.example.com:8443/r4")).toBe("port_not_allowed");
  });

  it("allows a port listed in INTEGRATION_ALLOWED_PORTS", () => {
    expect(errorOf("https://ehr.example.com:8443/r4", "8443")).toBe("ok");
    expect(errorOf("https://ehr.example.com:8443/r4", "8080, 8443")).toBe("ok");
  });

  it("ignores a malformed allow-list entry rather than throwing", () => {
    expect(errorOf("https://ehr.example.com:8443/r4", "not-a-port, 8443")).toBe("ok");
  });
});

describe("parseAllowedPorts", () => {
  it("always includes 443 regardless of input", () => {
    expect(parseAllowedPorts(undefined)).toEqual(new Set([443]));
    expect(parseAllowedPorts("")).toEqual(new Set([443]));
    expect(parseAllowedPorts("8443")).toEqual(new Set([443, 8443]));
  });

  it("drops out-of-range or non-numeric entries safely", () => {
    expect(parseAllowedPorts("0, 70000, -1, abc, 8443")).toEqual(new Set([443, 8443]));
  });

  it("only accepts 1-5 plain digits (security review PR #81): no sign, decimal, or exponent form", () => {
    expect(parseAllowedPorts("1e2")).toEqual(new Set([443]));
    expect(parseAllowedPorts("+80")).toEqual(new Set([443]));
    expect(parseAllowedPorts("80.0")).toEqual(new Set([443]));
    expect(parseAllowedPorts("999999")).toEqual(new Set([443]));
  });
});
