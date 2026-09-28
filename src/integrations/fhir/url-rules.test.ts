import { describe, expect, it } from "vitest";
import { allowedPorts, checkBaseUrl, SANDBOX_BASE_URL } from "./url-rules";

const ports443 = allowedPorts("443");

describe("checkBaseUrl (PI1b URL rules on save)", () => {
  it("accepts an https hostname URL and normalizes it", () => {
    expect(checkBaseUrl("https://FHIR.Example-EHR.com/R4/", ports443)).toEqual({
      ok: true,
      baseUrl: "https://fhir.example-ehr.com/R4",
      endpointKey: "https://fhir.example-ehr.com/r4",
      host: "fhir.example-ehr.com",
    });
  });

  it("drops the default port and every trailing slash; a bare host has an empty path", () => {
    const result = checkBaseUrl("https://fhir.example.com:443//", ports443);
    expect(result).toMatchObject({
      ok: true,
      baseUrl: "https://fhir.example.com",
      endpointKey: "https://fhir.example.com",
    });
  });

  it("gives two spellings of one endpoint the same key", () => {
    const a = checkBaseUrl("https://fhir.example.com/api/FHIR/R4", ports443);
    const b = checkBaseUrl("https://FHIR.EXAMPLE.COM:443/api/fhir/r4/", ports443);
    expect(a.ok && b.ok && a.endpointKey === b.endpointKey).toBe(true);
  });

  it("collapses repeated slashes inside the path", () => {
    expect(checkBaseUrl("https://fhir.example.com/api//FHIR///R4", ports443)).toMatchObject({
      ok: true,
      baseUrl: "https://fhir.example.com/api/FHIR/R4",
      endpointKey: "https://fhir.example.com/api/fhir/r4",
    });
  });

  it("keeps the endpoint key equal to the lowercased base URL (the registry's comparison)", () => {
    for (const raw of ["https://FHIR.Example.com/Api/R4", "https://fhir.example.com", SANDBOX_BASE_URL]) {
      const result = checkBaseUrl(raw, ports443);
      expect(result.ok && result.endpointKey === result.baseUrl.toLowerCase()).toBe(true);
    }
  });

  it("accepts the built-in sandbox even though it is under .invalid", () => {
    expect(checkBaseUrl(SANDBOX_BASE_URL, ports443)).toMatchObject({
      ok: true,
      baseUrl: SANDBOX_BASE_URL,
      endpointKey: SANDBOX_BASE_URL,
    });
  });

  it.each([
    ["", "invalid"],
    ["not a url", "invalid"],
    [`https://fhir.example.com/${"a".repeat(2100)}`, "too_long"],
    ["http://fhir.example.com/r4", "not_https"],
    ["ftp://fhir.example.com/r4", "not_https"],
    ["https://user:pass@fhir.example.com/r4", "credentials"],
    ["https://user@fhir.example.com/r4", "credentials"],
    ["https://@fhir.example.com/r4", "credentials"],
    ["https://fhir.example.com/r4?_format=json", "query_or_fragment"],
    ["https://fhir.example.com/r4?", "query_or_fragment"],
    ["https://fhir.example.com/r4#top", "query_or_fragment"],
    ["https://10.0.0.5/r4", "ip_literal"],
    ["https://169.254.169.254/latest", "ip_literal"],
    ["https://0x7f.1/r4", "ip_literal"],
    ["https://2130706433/r4", "ip_literal"],
    ["https://[::1]/r4", "ip_literal"],
    ["https://[fd00::1]/r4", "ip_literal"],
    ["https://localhost/r4", "reserved_host"],
    ["https://api.localhost/r4", "reserved_host"],
    ["https://ehr.local/r4", "reserved_host"],
    ["https://ehr.corp.internal/r4", "reserved_host"],
    ["https://ehr.home.arpa/r4", "reserved_host"],
    ["https://other.fhir.denialdesk.invalid/r4", "reserved_host"],
    ["https://ehrserver/r4", "single_label"],
    ["https://fhir.example.com./r4", "trailing_dot"],
    ["https://fhir.example.com:8443/r4", "port_not_allowed"],
    ["https://localhost.localdomain/r4", "reserved_host"],
    ["https://1.0.0.127.in-addr.arpa/r4", "reserved_host"],
    ["https://abcdefghijklmnop.onion/r4", "reserved_host"],
    ["https:fhir.example.com/r4", "invalid"],
    // One endpoint, one spelling (security review L-2); no free text in the path (compliance #8).
    ["https://fhir.example.com/%72%34", "path_characters"],
    ["https://fhir.example.com/r4;jsessionid=x", "path_characters"],
    ["https://fhir.example.com/api/../r4", "path_characters"],
    ["https://fhir.example.com/./r4", "path_characters"],
    ["https://fhir.example.com/John Smith/r4", "path_characters"],
    ["https://fhir.example.com/r4/$export", "path_characters"],
    ["https://ehr.example.com\\..\\admin", "path_characters"],
    ["https://ehr.example.com/r4\\x", "path_characters"],
  ])("refuses %s (%s)", (raw, code) => {
    expect(checkBaseUrl(raw, ports443)).toEqual({ ok: false, code });
  });

  it("allows a port listed in INTEGRATION_ALLOWED_PORTS and keeps it in the key", () => {
    const result = checkBaseUrl("https://fhir.example.com:8443/r4", allowedPorts("443, 8443"));
    expect(result).toMatchObject({ ok: true, endpointKey: "https://fhir.example.com:8443/r4" });
  });

  it("falls back to 443 when INTEGRATION_ALLOWED_PORTS is empty or malformed", () => {
    expect([...allowedPorts("")]).toEqual([443]);
    expect([...allowedPorts("abc, 70000")]).toEqual([443]);
    expect([...allowedPorts(undefined)]).toEqual([443]);
  });
});
