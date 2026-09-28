import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AZURE_WIRESERVER_ADDRESS,
  createGuardedLookup,
  DENIED_IPV4_SUBNETS,
  DENIED_IPV6_SUBNETS,
  DNS_TIMEOUT_MS,
  embeddedIPv4Candidates,
  isAddressAllowed,
  isAddressGuardError,
  isAddressPermitted,
  isInGlobalUnicastSpace,
  matchesDeniedIPv6Range,
  parseIPv6Groups,
  type DnsLookupFn,
} from "./address-guard";
import { TransportError } from "./errors";

describe("isAddressAllowed — IPv4 special-purpose ranges (deny)", () => {
  it.each([
    ["0.0.0.0/8 (this network)", "0.0.0.1"],
    ["10.0.0.0/8 (private)", "10.1.2.3"],
    ["100.64.0.0/10 (CGNAT)", "100.64.0.1"],
    ["100.64.0.0/10 upper boundary", "100.127.255.255"],
    ["127.0.0.0/8 (loopback)", "127.0.0.1"],
    ["169.254.0.0/16 (link-local)", "169.254.1.1"],
    ["172.16.0.0/12 (private)", "172.31.255.255"],
    ["192.0.0.0/24 (IETF protocol assignments)", "192.0.0.8"],
    ["192.0.2.0/24 (documentation TEST-NET-1)", "192.0.2.55"],
    ["192.88.99.0/24 (6to4 relay, deprecated)", "192.88.99.1"],
    ["192.168.0.0/16 (private)", "192.168.1.1"],
    ["198.18.0.0/15 (benchmarking)", "198.18.0.1"],
    ["198.18.0.0/15 upper boundary", "198.19.255.255"],
    ["198.51.100.0/24 (documentation TEST-NET-2)", "198.51.100.1"],
    ["203.0.113.0/24 (documentation TEST-NET-3)", "203.0.113.1"],
    ["224.0.0.0/4 (multicast)", "224.0.0.1"],
    ["240.0.0.0/4 (reserved)", "240.0.0.1"],
    ["255.255.255.255/32 (limited broadcast)", "255.255.255.255"],
    ["Azure WireServer", AZURE_WIRESERVER_ADDRESS],
  ])("refuses %s", (_label, address) => {
    expect(isAddressAllowed(address, 4)).toBe(false);
  });

  it.each([
    ["a public address just below 100.64.0.0/10", "100.63.255.255"],
    ["a public address just above 100.64.0.0/10", "100.128.0.0"],
    ["a public address just below 198.18.0.0/15", "198.17.255.255"],
    ["a public address just above 198.18.0.0/15", "198.20.0.0"],
    ["an ordinary public address", "8.8.8.8"],
  ])("allows %s", (_label, address) => {
    expect(isAddressAllowed(address, 4)).toBe(true);
  });
});

describe("isAddressAllowed — IPv6 (must be inside 2000::/3, then not special-purpose)", () => {
  it("refuses everything outside the global-unicast allocation 2000::/3", () => {
    for (const address of [
      "::", // unspecified
      "::1", // loopback
      "fec0::1", // site-local (deprecated, RFC 3879)
      "fc00::1", // unique-local
      "fd00::1", // unique-local upper half
      "fe80::1", // link-local
      "ff02::1", // multicast
      "4000::1", // unallocated (outside 2000::/3)
      "1fff:ffff::1", // just below 2000::/3
      "100:0:0:1::1", // just outside the 100::/64 discard-only block; not global unicast either
      "::ffff:0:10.0.0.1", // IPv4-translated (::ffff:0:0:0/96) carrying 10.0.0.1
      "::ffff:8.8.8.8", // IPv4-mapped, even with a public IPv4
      "64:ff9b::8.8.8.8", // NAT64 well-known prefix, even with a public IPv4 (deny outright)
    ]) {
      expect(isAddressAllowed(address, 6), address).toBe(false);
    }
  });

  it("2000::/3 boundaries: 2000:: and 3fff:ffff:: are inside; 1fff and 4000 are outside", () => {
    expect(isInGlobalUnicastSpace(parseIPv6Groups("2000::")!)).toBe(true);
    expect(isInGlobalUnicastSpace(parseIPv6Groups("3ffe:ffff::1")!)).toBe(true);
    expect(isInGlobalUnicastSpace(parseIPv6Groups("1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff")!)).toBe(false);
    expect(isInGlobalUnicastSpace(parseIPv6Groups("4000::")!)).toBe(false);
  });

  it("allows ordinary global unicast addresses", () => {
    expect(isAddressAllowed("2606:4700:4700::1111", 6)).toBe(true);
    expect(isAddressAllowed("2a00:1450:4001:81b::200e", 6)).toBe(true);
    // Just outside neighbouring denied blocks.
    expect(isAddressAllowed("2001:200::1", 6)).toBe(true); // above 2001::/23 (RFC 6890)
    expect(isAddressAllowed("2001:4860:4860::8888", 6)).toBe(true);
    expect(isAddressAllowed("3ffe::1", 6)).toBe(true); // below 3fff::/20 (not in the registry)
  });

  it("refuses an unparseable IPv6 string", () => {
    expect(isAddressAllowed("not-an-address", 6)).toBe(false);
    expect(isAddressAllowed("1::2::3", 6)).toBe(false);
  });
  it("refuses an unparseable IPv4 string", () => {
    expect(isAddressAllowed("not-an-address", 4)).toBe(false);
    expect(isAddressAllowed("300.1.1.1", 4)).toBe(false);
  });
});

describe("IPv6 deny list — one test per range (against the list itself, not only the /3 rule)", () => {
  // A representative address inside each denied range. Every entry of DENIED_IPV6_SUBNETS must
  // appear here (asserted below), so adding a range without a test fails this file.
  const SAMPLES: Record<string, string> = {
    "::/128": "::",
    "::1/128": "::1",
    "::/96": "::0.0.0.5",
    "64:ff9b:1::/48": "64:ff9b:1::1",
    "100::/64": "100::1",
    "2001::/23": "2001:1ff::1",
    "2001::/32": "2001:0:4136:e378:8000:63bf:3fff:fdd2",
    "2001:2::/48": "2001:2::1",
    "2001:10::/28": "2001:10::1",
    "2001:20::/28": "2001:20::1",
    "2001:30::/28": "2001:30::1",
    "2001:db8::/32": "2001:db8::1",
    "2002::/16": "2002:808:808::1",
    "2620:4f:8000::/48": "2620:4f:8000::1",
    "3fff::/20": "3fff::1",
    "5f00::/16": "5f00::1",
    "fc00::/7": "fc00::1",
    "fe80::/10": "fe80::1",
    "fec0::/10": "fec0::1",
    "ff00::/8": "ff02::1",
  };

  it("has a sample for every listed range", () => {
    const listed = DENIED_IPV6_SUBNETS.map(([address, prefix]) => `${address}/${prefix}`).sort();
    // Normalize the list's spelling ("::" + 128 -> "::/128") against the sample keys.
    expect(Object.keys(SAMPLES).sort()).toEqual(listed);
  });

  it.each(Object.entries(SAMPLES))("denies %s (sample %s)", (_range, address) => {
    expect(matchesDeniedIPv6Range(address)).toBe(true);
    expect(isAddressAllowed(address, 6)).toBe(false);
  });

  // Ranges that lie INSIDE 2000::/3, so only the deny list (not the /3 rule) can refuse them. The
  // four 2001:x ranges sit inside the denied 2001::/23, so nothing next to them is allowed either.
  it.each([
    ["2001:2::/48 benchmarking (RFC 5180)", "2001:2::1", undefined],
    ["2001:10::/28 ORCHID (RFC 4843)", "2001:1f:ffff::1", undefined],
    ["2001:20::/28 ORCHIDv2 (RFC 7343)", "2001:2f:ffff::1", undefined],
    ["2001:30::/28 DETs (RFC 9374)", "2001:3f:ffff::1", undefined],
    ["2001:db8::/32 documentation (RFC 3849)", "2001:db8:ffff::1", "2001:db9::1"],
    ["2620:4f:8000::/48 AS112 (RFC 7534)", "2620:4f:8000:ffff::1", "2620:4f:8001::1"],
    ["3fff::/20 documentation (RFC 9637)", "3fff:fff:ffff::1", "3fff:1000::1"],
    ["2002::/16 6to4 (RFC 3056, denied outright)", "2002:808:808::1", "2003::1"],
  ])("%s: inside is refused, and the neighbour past the block (if any) is allowed", (_l, inside, past) => {
    expect(isInGlobalUnicastSpace(parseIPv6Groups(inside)!)).toBe(true);
    expect(matchesDeniedIPv6Range(inside)).toBe(true);
    expect(isAddressAllowed(inside, 6)).toBe(false);
    if (past) expect(isAddressAllowed(past, 6)).toBe(true);
  });

  // 5f00::/16 (RFC 9602) is outside 2000::/3: refused by the /3 rule AND listed.
  it("5f00::/16 SRv6 SIDs (RFC 9602) is refused, and so are its neighbours (outside 2000::/3)", () => {
    expect(matchesDeniedIPv6Range("5f00:ffff::1")).toBe(true);
    expect(matchesDeniedIPv6Range("5f01::1")).toBe(false);
    for (const address of ["5f00::1", "5f00:ffff::1", "5e00::1", "5f01::1"]) {
      expect(isAddressAllowed(address, 6), address).toBe(false);
    }
  });

  it("denies the whole of 2001::/23, including the registry's globally-reachable sub-assignments", () => {
    for (const address of [
      "2001::1", // Teredo (RFC 4380)
      "2001:1::1", // PCP anycast (RFC 7723)
      "2001:1::2", // TURN anycast (RFC 8155)
      "2001:3::1", // AMT (RFC 7450)
      "2001:4:112::1", // AS112-v6 (RFC 7535)
      "2001:1ff:ffff::1", // top of the /23
    ]) {
      expect(isAddressAllowed(address, 6), address).toBe(false);
    }
    expect(isAddressAllowed("2001:200::1", 6)).toBe(true); // first address past the /23
  });
});

describe("IPv4 deny list — first and last address of every listed range", () => {
  const toNumber = (ip: string) => ip.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);
  const toIp = (n: number) => [24, 16, 8, 0].map((shift) => Math.floor(n / 2 ** shift) % 256).join(".");

  it.each(DENIED_IPV4_SUBNETS.map(([address, prefix]) => [`${address}/${prefix}`, address, prefix] as const))(
    "denies both ends of %s",
    (_range, address, prefix) => {
      const size = 2 ** (32 - prefix);
      const first = toNumber(address);
      expect(isAddressAllowed(toIp(first), 4)).toBe(false);
      expect(isAddressAllowed(toIp(first + size - 1), 4)).toBe(false);
    },
  );
});

describe("isAddressPermitted", () => {
  it("is the guard alone by default and OR's in the test hook", () => {
    expect(isAddressPermitted("127.0.0.1", 4)).toBe(false);
    expect(isAddressPermitted("127.0.0.1", 4, () => false)).toBe(false);
    expect(isAddressPermitted("127.0.0.1", 4, (a) => a === "127.0.0.1")).toBe(true);
    expect(isAddressPermitted("8.8.8.8", 4)).toBe(true);
  });
});

describe("isAddressAllowed — embedded IPv4 decode and re-check", () => {
  it("refuses an IPv4-mapped address carrying a private IPv4", () => {
    expect(isAddressAllowed("::ffff:10.1.2.3", 6)).toBe(false);
  });
  it("refuses an IPv4-mapped address carrying a public IPv4 (outside 2000::/3)", () => {
    expect(isAddressAllowed("::ffff:8.8.8.8", 6)).toBe(false);
  });

  it("refuses an IPv4-compatible address carrying a private or a public IPv4", () => {
    expect(isAddressAllowed("::10.1.2.3", 6)).toBe(false);
    expect(isAddressAllowed("::8.8.8.8", 6)).toBe(false);
    // The embedded value is still decoded correctly; it's the outer, deprecated form that's denied.
    expect(embeddedIPv4Candidates(parseIPv6Groups("::8.8.8.8")!)).toContain("8.8.8.8");
  });

  it("refuses NAT64 well-known-prefix (64:ff9b::/96), private or public IPv4 (outside 2000::/3)", () => {
    expect(isAddressAllowed("64:ff9b::10.1.2.3", 6)).toBe(false);
    expect(isAddressAllowed("64:ff9b::8.8.8.8", 6)).toBe(false);
    expect(embeddedIPv4Candidates(parseIPv6Groups("64:ff9b::8.8.8.8")!)).toContain("8.8.8.8");
  });

  it("refuses NAT64 local-use prefix (64:ff9b:1::/48) carrying a private IPv4", () => {
    // 64:ff9b:1:a00:0:100:0:0 embeds 10.0.0.1 per RFC 6052 §2.2's /48 layout.
    expect(isAddressAllowed("64:ff9b:1:a00:0:100:0:0", 6)).toBe(false);
  });

  it("refuses 6to4 (2002::/16) outright: private AND public embedded IPv4", () => {
    expect(isAddressAllowed("2002:a01:203::", 6)).toBe(false); // embeds 10.1.2.3
    expect(isAddressAllowed("2002:808:808::", 6)).toBe(false); // embeds 8.8.8.8
    expect(embeddedIPv4Candidates(parseIPv6Groups("2002:808:808::")!)).toContain("8.8.8.8");
  });

  it("refuses Teredo (2001::/32, inside the denied 2001::/23): private AND public client IPv4", () => {
    // Client 10.1.2.3 obfuscated (XOR 0xffffffff) -> f5fe:fdfc in the trailing groups.
    const privateClient = "2001:0:4136:e378:8000:63bf:f5fe:fdfc";
    expect(embeddedIPv4Candidates(parseIPv6Groups(privateClient)!)).toContain("10.1.2.3");
    expect(isAddressAllowed(privateClient, 6)).toBe(false);
    const publicClient = "2001:0:4136:e378:8000:63bf:f7f7:f7f7"; // client 8.8.8.8
    expect(embeddedIPv4Candidates(parseIPv6Groups(publicClient)!)).toContain("8.8.8.8");
    expect(isAddressAllowed(publicClient, 6)).toBe(false);
  });
});

describe("parseIPv6Groups", () => {
  it("returns null for a garbled address", () => {
    expect(parseIPv6Groups("not-an-address")).toBeNull();
  });
  it("returns null for a malformed double-colon address", () => {
    expect(parseIPv6Groups("1::2::3")).toBeNull();
  });
  it("round-trips a full 8-group address", () => {
    expect(parseIPv6Groups("2001:db8:0:0:0:0:0:1")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
  });
  it("ignores a zone id", () => {
    expect(parseIPv6Groups("fe80::1%eth0")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
  });
});

describe("createGuardedLookup", () => {
  async function runLookup(
    lookup: ReturnType<typeof createGuardedLookup>,
    hostname: string,
    all: boolean,
  ): Promise<{ err: NodeJS.ErrnoException | null; address: string | { address: string; family: number }[] }> {
    return await new Promise((resolve) => {
      lookup(hostname, { all, family: 0 } as never, (err, address) =>
        resolve({ err: err ?? null, address: address as never }),
      );
    });
  }

  /** A stand-in for `dns.lookup` that always answers with these addresses (test-only DI). */
  function fakeResolve(addresses: Array<{ address: string; family: number }>): DnsLookupFn {
    return ((_hostname: string, _options: unknown, callback: (err: null, result: unknown) => void) =>
      callback(null, addresses)) as unknown as DnsLookupFn;
  }

  it("refuses when a mocked DNS resolution returns only a blocked address", async () => {
    const lookup = createGuardedLookup({ resolve: fakeResolve([{ address: "10.1.2.3", family: 4 }]) });
    const { err } = await runLookup(lookup, "internal.example", false);
    expect(err?.code).toBe("EADDRESSREFUSED");
  });

  it("refuses when ANY of several resolved addresses is blocked, even if others are public", async () => {
    const lookup = createGuardedLookup({
      resolve: fakeResolve([
        { address: "8.8.8.8", family: 4 },
        { address: "10.1.2.3", family: 4 }, // rebinding / multi-A-record attempt
      ]),
    });
    const { err } = await runLookup(lookup, "mixed.example", true);
    expect(err?.code).toBe("EADDRESSREFUSED");
  });

  it("passes every resolved address through when all are public and options.all is set", async () => {
    const addresses = [
      { address: "8.8.8.8", family: 4 },
      { address: "1.1.1.1", family: 4 },
    ];
    const lookup = createGuardedLookup({ resolve: fakeResolve(addresses) });
    const { err, address } = await runLookup(lookup, "public.example", true);
    expect(err).toBeNull();
    expect(address).toEqual(addresses);
  });

  it("returns a single address and family when options.all is not set", async () => {
    const lookup = createGuardedLookup({ resolve: fakeResolve([{ address: "8.8.8.8", family: 4 }]) });
    const result = await new Promise<{
      err: NodeJS.ErrnoException | null;
      address: unknown;
      family: unknown;
    }>((resolve) => {
      lookup("public.example", { all: false, family: 0 } as never, (err, address, family) =>
        resolve({ err: err ?? null, address, family }),
      );
    });
    expect(result.err).toBeNull();
    expect(result.address).toBe("8.8.8.8");
    expect(result.family).toBe(4);
  });

  it("refuses loopback by default but allows it once the allow-hook says so", async () => {
    const denied = createGuardedLookup();
    const deniedResult = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
      denied("localhost", { all: false, family: 4 } as never, (err) => resolve(err));
    });
    expect(deniedResult?.code).toBe("EADDRESSREFUSED");

    const allowed = createGuardedLookup({ allowAddress: (address) => address === "127.0.0.1" });
    const allowedResult = await new Promise<{ err: NodeJS.ErrnoException | null; address: unknown }>(
      (resolve) => {
        allowed("localhost", { all: false, family: 4 } as never, (err, address) => resolve({ err, address }));
      },
    );
    expect(allowedResult.err).toBeNull();
    expect(allowedResult.address).toBe("127.0.0.1");
  });

  it("times out a DNS lookup that never resolves (5 s default)", async () => {
    vi.useFakeTimers();
    try {
      // A resolve implementation that never calls back — the guard's own timer must still fire.
      const neverResolves: DnsLookupFn = (() => {
        /* never calls back */
      }) as unknown as DnsLookupFn;
      const lookup = createGuardedLookup({ resolve: neverResolves });
      const pending = new Promise<NodeJS.ErrnoException | null>((resolve) => {
        lookup("stalls.invalid", { all: false, family: 4 } as never, (err) => resolve(err));
      });
      await vi.advanceTimersByTimeAsync(DNS_TIMEOUT_MS + 1);
      const err = await pending;
      expect(err?.code).toBe("ETIMEOUT");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createGuardedLookup — test-only options are refused outside a test run", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["allowAddress", { allowAddress: () => true }],
    ["timeoutMs", { timeoutMs: 1 }],
    ["resolve", { resolve: (() => undefined) as unknown as DnsLookupFn }],
  ])("throws for %s outside a test run", (name, options) => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createGuardedLookup(options)).toThrow(new RegExp(`"${name}" option is test-only`));
  });

  it("builds a default lookup outside a test run", () => {
    vi.stubEnv("VITEST", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createGuardedLookup()).not.toThrow();
  });
});

describe("isAddressGuardError", () => {
  it("maps an address-guard refusal to a TransportError('address_refused')", () => {
    const error = Object.assign(new Error("x"), { code: "EADDRESSREFUSED" });
    const mapped = isAddressGuardError(error);
    expect(mapped).toBeInstanceOf(TransportError);
    expect(mapped?.code).toBe("address_refused");
  });
  it("maps the guard's DNS timeout to a TransportError('timeout')", () => {
    const error = Object.assign(new Error("x"), { code: "ETIMEOUT" });
    expect(isAddressGuardError(error)?.code).toBe("timeout");
  });
  it("returns undefined for an unrelated error", () => {
    expect(isAddressGuardError(new Error("boom"))).toBeUndefined();
  });
});
