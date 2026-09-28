import { describe, expect, it } from "vitest";
import { clientKey, ipv6Network64, limitFor } from "./rate-limit";

describe("ipv6Network64 (the public jwks bucket keys an IPv6 client by its /64)", () => {
  it("maps every address in one /64 to one key", () => {
    const a = ipv6Network64("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(ipv6Network64("2001:db8:1:2::1")).toBe(a);
    expect(ipv6Network64("2001:0db8:0001:0002:0000:0000:0000:0001")).toBe(a);
    expect(ipv6Network64("2001:DB8:1:2:ffff:ffff:ffff:ffff")).toBe(a);
  });

  it("separates different /64s, including ones that differ only in the fourth hextet", () => {
    expect(ipv6Network64("2001:db8:1:2::1")).not.toBe(ipv6Network64("2001:db8:1:3::1"));
    expect(ipv6Network64("2001:db8:1:2::1")).not.toBe(ipv6Network64("2001:db8:2:2::1"));
  });

  it("expands :: correctly wherever it appears", () => {
    expect(ipv6Network64("::1")).toBe("0:0:0:0::/64");
    expect(ipv6Network64("::")).toBe("0:0:0:0::/64");
    expect(ipv6Network64("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(ipv6Network64("2001:db8::5:6:7")).toBe("2001:db8:0:0::/64");
    expect(ipv6Network64("1:2:3:4::")).toBe("1:2:3:4::/64");
    expect(ipv6Network64("1::8")).toBe("1:0:0:0::/64");
  });

  it("handles an embedded IPv4 tail and a zone id", () => {
    // IPv4-mapped and IPv4-compatible addresses are keyed by the embedded IPv4, not one shared /64.
    expect(ipv6Network64("::ffff:192.0.2.1")).toBe("192.0.2.1");
    expect(ipv6Network64("::ffff:c000:201")).toBe("192.0.2.1");
    expect(ipv6Network64("::ffff:198.51.100.7")).not.toBe(ipv6Network64("::ffff:192.0.2.1"));
    expect(ipv6Network64("::192.0.2.1")).toBe("192.0.2.1");
    // A dotted tail counts as two hextets when "::" is expanded.
    expect(ipv6Network64("1::2:3:4:1.2.3.4")).toBe("1:0:0:2::/64");
    expect(ipv6Network64("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
  });

  it("leaves IPv4 and non-IP values unchanged", () => {
    expect(ipv6Network64("198.51.100.7")).toBe("198.51.100.7");
    expect(ipv6Network64("unknown")).toBe("unknown");
  });
});

describe("clientKey", () => {
  const v6 = "2001:db8:1:2:aaaa:bbbb:cccc:dddd";

  it("collapses an IPv6 client to its /64 for the jwks bucket only", () => {
    expect(clientKey("jwks", v6)).toBe("2001:db8:1:2::/64");
    expect(clientKey("sign_in", v6)).toBe(v6);
    expect(clientKey("integration_test_practice", v6)).toBe(v6);
  });

  it("keeps IPv4 as is and unknown clients in one shared bucket", () => {
    expect(clientKey("jwks", "198.51.100.7")).toBe("198.51.100.7");
    expect(clientKey("jwks", null)).toBe("unknown");
    expect(clientKey("sign_in", null)).toBe("unknown");
  });
});

describe("jwks bucket policy", () => {
  it("is its own bucket: 120 per minute", () => {
    expect(limitFor("jwks")).toEqual({ limit: 120, windowSeconds: 60 });
  });
});
